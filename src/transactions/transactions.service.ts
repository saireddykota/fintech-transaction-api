import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { v4 as uuidv4 } from 'uuid';
import { Transaction, TransactionDocument, TransactionStatus } from './entities/transaction.entity';
import { CreateTransactionDto, TransactionQueryDto } from './dto/transaction.dto';
import { KafkaService } from '../kafka/kafka.service';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);
  private readonly CACHE_TTL = 60 * 2; // 2 minutes for transaction data

  constructor(
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    private readonly kafkaService: KafkaService,
  ) {}

  async create(
    createTransactionDto: CreateTransactionDto,
    userId: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<Transaction> {
    const notionalValue = createTransactionDto.quantity * createTransactionDto.price;

    const transaction = new this.transactionModel({
      ...createTransactionDto,
      transactionId: uuidv4(),
      notionalValue,
      status: TransactionStatus.PENDING,
      auditLog: {
        createdBy: userId,
        ipAddress,
        userAgent,
      },
    });

    const saved = await transaction.save();
    this.logger.log(`Transaction created: ${saved.transactionId} | Portfolio: ${saved.portfolioId} | Type: ${saved.type} | Notional: ${saved.currency} ${saved.notionalValue}`);

    // Publish to Kafka for async processing — decouples ingestion from settlement
    await this.kafkaService.publishTransactionEvent({
      eventType: 'TRANSACTION_CREATED',
      transactionId: saved.transactionId,
      portfolioId: saved.portfolioId,
      type: saved.type,
      assetClass: saved.assetClass,
      notionalValue: saved.notionalValue,
      currency: saved.currency,
      settlementDate: saved.settlementDate,
      timestamp: new Date().toISOString(),
    });

    // Invalidate portfolio cache on new transaction
    await this.invalidatePortfolioCache(saved.portfolioId);

    return saved;
  }

  async findAll(query: TransactionQueryDto): Promise<{ data: Transaction[]; total: number; page: number; limit: number }> {
    const {
      portfolioId, accountId, type, assetClass,
      status, fromDate, toDate, page = 1, limit = 50,
    } = query;

    // Build optimized filter using compound indexes
    const filter: Record<string, any> = {};
    if (portfolioId) filter.portfolioId = portfolioId;
    if (accountId) filter.accountId = accountId;
    if (type) filter.type = type;
    if (assetClass) filter.assetClass = assetClass;
    if (status) filter.status = status;
    if (fromDate || toDate) {
      filter.tradeDate = {};
      if (fromDate) filter.tradeDate.$gte = new Date(fromDate);
      if (toDate) filter.tradeDate.$lte = new Date(toDate);
    }

    // Check Redis cache first for portfolio-level queries
    const cacheKey = `txns:${portfolioId}:${page}:${limit}:${status || 'all'}`;
    if (portfolioId) {
      const cached = await this.cacheManager.get<any>(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit: ${cacheKey}`);
        return cached;
      }
    }

    const [data, total] = await Promise.all([
      this.transactionModel
        .find(filter)
        .sort({ tradeDate: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.transactionModel.countDocuments(filter).exec(),
    ]);

    const result = { data, total, page, limit };

    // Cache portfolio query results
    if (portfolioId) {
      await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
    }

    return result;
  }

  async findOne(transactionId: string): Promise<Transaction> {
    const cacheKey = `txn:${transactionId}`;
    const cached = await this.cacheManager.get<Transaction>(cacheKey);
    if (cached) return cached;

    const transaction = await this.transactionModel
      .findOne({ transactionId })
      .lean()
      .exec();

    if (!transaction) {
      throw new NotFoundException(`Transaction ${transactionId} not found`);
    }

    await this.cacheManager.set(cacheKey, transaction, this.CACHE_TTL);
    return transaction;
  }

  async updateStatus(
    transactionId: string,
    status: TransactionStatus,
    userId: string,
  ): Promise<Transaction> {
    const transaction = await this.transactionModel.findOne({ transactionId });
    if (!transaction) throw new NotFoundException(`Transaction ${transactionId} not found`);

    // Validate status transition
    this.validateStatusTransition(transaction.status, status);

    transaction.status = status;
    if (status === TransactionStatus.SETTLED) {
      transaction.auditLog = { ...transaction.auditLog, processedBy: userId };
    }

    const updated = await transaction.save();

    // Publish status change event to Kafka
    await this.kafkaService.publishTransactionEvent({
      eventType: 'TRANSACTION_STATUS_UPDATED',
      transactionId: updated.transactionId,
      portfolioId: updated.portfolioId,
      previousStatus: transaction.status,
      newStatus: status,
      timestamp: new Date().toISOString(),
    });

    // Invalidate caches
    await this.cacheManager.del(`txn:${transactionId}`);
    await this.invalidatePortfolioCache(updated.portfolioId);

    return updated;
  }

  // Portfolio-level aggregation — optimized with compound indexes
  async getPortfolioSummary(portfolioId: string): Promise<any> {
    const cacheKey = `portfolio:summary:${portfolioId}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    const summary = await this.transactionModel.aggregate([
      { $match: { portfolioId, status: TransactionStatus.SETTLED } },
      {
        $group: {
          _id: { assetClass: '$assetClass', currency: '$currency' },
          totalNotional: { $sum: '$notionalValue' },
          transactionCount: { $sum: 1 },
          avgPrice: { $avg: '$price' },
        },
      },
      {
        $group: {
          _id: '$_id.currency',
          positions: {
            $push: {
              assetClass: '$_id.assetClass',
              totalNotional: '$totalNotional',
              transactionCount: '$transactionCount',
              avgPrice: '$avgPrice',
            },
          },
          totalPortfolioValue: { $sum: '$totalNotional' },
        },
      },
      { $sort: { totalPortfolioValue: -1 } },
    ]);

    await this.cacheManager.set(cacheKey, summary, this.CACHE_TTL);
    return summary;
  }

  private validateStatusTransition(current: TransactionStatus, next: TransactionStatus): void {
    const validTransitions: Record<TransactionStatus, TransactionStatus[]> = {
      [TransactionStatus.PENDING]: [TransactionStatus.PROCESSING, TransactionStatus.CANCELLED],
      [TransactionStatus.PROCESSING]: [TransactionStatus.SETTLED, TransactionStatus.FAILED],
      [TransactionStatus.SETTLED]: [],
      [TransactionStatus.FAILED]: [TransactionStatus.PENDING],
      [TransactionStatus.CANCELLED]: [],
    };

    if (!validTransitions[current].includes(next)) {
      throw new BadRequestException(
        `Invalid status transition: ${current} -> ${next}`,
      );
    }
  }

  private async invalidatePortfolioCache(portfolioId: string): Promise<void> {
    // Invalidate all cached pages for this portfolio
    for (let page = 1; page <= 10; page++) {
      await this.cacheManager.del(`txns:${portfolioId}:${page}:50:all`);
    }
    await this.cacheManager.del(`portfolio:summary:${portfolioId}`);
  }
}
