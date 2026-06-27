import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { v4 as uuidv4 } from 'uuid';
import { Portfolio, PortfolioDocument, PortfolioStatus } from './portfolio.entity';

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);
  private readonly CACHE_TTL = 60 * 5; // 5 minutes

  constructor(
    @InjectModel(Portfolio.name)
    private readonly portfolioModel: Model<PortfolioDocument>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  async create(createDto: any, userId: string): Promise<Portfolio> {
    const portfolio = new this.portfolioModel({
      ...createDto,
      portfolioId: uuidv4(),
      authorizedUsers: [userId],
    });
    const saved = await portfolio.save();
    this.logger.log(`Portfolio created: ${saved.portfolioId} | Type: ${saved.type}`);
    return saved;
  }

  async findById(portfolioId: string): Promise<Portfolio> {
    const cacheKey = `portfolio:${portfolioId}`;
    const cached = await this.cacheManager.get<Portfolio>(cacheKey);
    if (cached) return cached;

    const portfolio = await this.portfolioModel
      .findOne({ portfolioId })
      .lean()
      .exec();

    if (!portfolio) throw new NotFoundException(`Portfolio ${portfolioId} not found`);

    await this.cacheManager.set(cacheKey, portfolio, this.CACHE_TTL);
    return portfolio;
  }

  async findByManager(managerId: string): Promise<Portfolio[]> {
    const cacheKey = `portfolios:manager:${managerId}`;
    const cached = await this.cacheManager.get<Portfolio[]>(cacheKey);
    if (cached) return cached;

    const portfolios = await this.portfolioModel
      .find({ managerId, status: PortfolioStatus.ACTIVE })
      .sort({ inceptionDate: -1 })
      .lean()
      .exec();

    await this.cacheManager.set(cacheKey, portfolios, this.CACHE_TTL);
    return portfolios;
  }

  async updateNav(portfolioId: string, totalNav: number): Promise<Portfolio> {
    const portfolio = await this.portfolioModel.findOneAndUpdate(
      { portfolioId },
      { totalNav, updatedAt: new Date() },
      { new: true },
    );
    if (!portfolio) throw new NotFoundException(`Portfolio ${portfolioId} not found`);

    // Invalidate cache on NAV update
    await this.cacheManager.del(`portfolio:${portfolioId}`);
    this.logger.log(`NAV updated for portfolio ${portfolioId}: ${totalNav}`);
    return portfolio;
  }

  // Portfolio-level position summary using optimized aggregation pipeline
  async getPositionSummary(portfolioId: string): Promise<any> {
    const cacheKey = `portfolio:positions:${portfolioId}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    const summary = await this.portfolioModel.aggregate([
      { $match: { portfolioId } },
      {
        $lookup: {
          from: 'transactions',
          localField: 'portfolioId',
          foreignField: 'portfolioId',
          pipeline: [
            { $match: { status: 'SETTLED' } },
            {
              $group: {
                _id: { instrumentId: '$instrumentId', assetClass: '$assetClass' },
                totalQuantity: { $sum: '$quantity' },
                totalNotional: { $sum: '$notionalValue' },
                avgPrice: { $avg: '$price' },
                tradeCount: { $sum: 1 },
              },
            },
          ],
          as: 'positions',
        },
      },
      {
        $project: {
          portfolioId: 1,
          name: 1,
          type: 1,
          baseCurrency: 1,
          totalNav: 1,
          positions: 1,
          positionCount: { $size: '$positions' },
        },
      },
    ]);

    const result = summary[0] || null;
    if (result) await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }
}
