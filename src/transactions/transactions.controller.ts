import {
  Controller, Get, Post, Body, Param, Patch,
  Query, UseGuards, Request, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto, TransactionQueryDto } from './dto/transaction.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { TransactionStatus } from './entities/transaction.entity';

@Controller('transactions')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  /**
   * Create a new financial transaction
   * Publishes to Kafka for async settlement processing
   */
  @Post()
  @Roles('trader', 'portfolio_manager', 'admin')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createTransactionDto: CreateTransactionDto,
    @Request() req: any,
  ) {
    return this.transactionsService.create(
      createTransactionDto,
      req.user.userId,
      req.ip,
      req.headers['user-agent'],
    );
  }

  /**
   * Query transactions with filtering and pagination
   * Results cached in Redis for portfolio-level queries
   */
  @Get()
  @Roles('trader', 'portfolio_manager', 'analyst', 'admin', 'compliance')
  async findAll(@Query() query: TransactionQueryDto) {
    return this.transactionsService.findAll(query);
  }

  /**
   * Get portfolio summary — aggregated position data
   * Uses optimized MongoDB aggregation pipeline
   */
  @Get('portfolio/:portfolioId/summary')
  @Roles('portfolio_manager', 'analyst', 'admin', 'compliance')
  async getPortfolioSummary(@Param('portfolioId') portfolioId: string) {
    return this.transactionsService.getPortfolioSummary(portfolioId);
  }

  /**
   * Get single transaction by ID
   */
  @Get(':transactionId')
  @Roles('trader', 'portfolio_manager', 'analyst', 'admin', 'compliance')
  async findOne(@Param('transactionId') transactionId: string) {
    return this.transactionsService.findOne(transactionId);
  }

  /**
   * Update transaction status (settlement workflow)
   */
  @Patch(':transactionId/status')
  @Roles('operations', 'admin')
  async updateStatus(
    @Param('transactionId') transactionId: string,
    @Body('status') status: TransactionStatus,
    @Request() req: any,
  ) {
    return this.transactionsService.updateStatus(transactionId, status, req.user.userId);
  }
}
