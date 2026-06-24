import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { CacheModule } from '@nestjs/cache-manager';
import { TransactionsModule } from './transactions/transactions.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { AuthModule } from './auth/auth.module';
import { KafkaModule } from './kafka/kafka.module';

@Module({
  imports: [
    // Environment configuration
    ConfigModule.forRoot({ isGlobal: true }),

    // MongoDB connection with optimized settings for financial data
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
        // Connection pool optimized for high-volume financial transactions
        maxPoolSize: 20,
        minPoolSize: 5,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        // Read preference for portfolio queries — secondaryPreferred for load distribution
        readPreference: 'secondaryPreferred',
      }),
      inject: [ConfigService],
    }),

    // Redis caching for high-frequency financial data lookups
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        store: require('cache-manager-ioredis-yet'),
        host: configService.get('REDIS_HOST', 'localhost'),
        port: configService.get<number>('REDIS_PORT', 6379),
        password: configService.get('REDIS_PASSWORD'),
        ttl: 60 * 5, // 5 minute default TTL for financial reference data
      }),
      inject: [ConfigService],
    }),

    // Rate limiting — critical for financial API security
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,
        limit: 10, // Max 10 requests per second per client
      },
      {
        name: 'long',
        ttl: 60000,
        limit: 200, // Max 200 requests per minute per client
      },
    ]),

    AuthModule,
    TransactionsModule,
    PortfolioModule,
    KafkaModule,
  ],
})
export class AppModule {}
