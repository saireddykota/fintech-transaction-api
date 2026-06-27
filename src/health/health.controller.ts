import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly mongoConnection: Connection,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  @Get()
  async check() {
    const checks = await Promise.allSettled([
      this.checkMongoDB(),
      this.checkRedis(),
    ]);

    const mongodb = checks[0].status === 'fulfilled' ? checks[0].value : { status: 'down', error: checks[0].reason?.message };
    const redis = checks[1].status === 'fulfilled' ? checks[1].value : { status: 'down', error: checks[1].reason?.message };

    const allHealthy = mongodb.status === 'up' && redis.status === 'up';

    return {
      status: allHealthy ? 'up' : 'degraded',
      timestamp: new Date().toISOString(),
      services: { mongodb, redis },
    };
  }

  @Get('live')
  liveness() {
    return { status: 'up', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  async readiness() {
    const mongoReady = this.mongoConnection.readyState === 1;
    return {
      status: mongoReady ? 'ready' : 'not ready',
      timestamp: new Date().toISOString(),
    };
  }

  private async checkMongoDB() {
    const state = this.mongoConnection.readyState;
    if (state !== 1) throw new Error(`MongoDB state: ${state}`);
    return { status: 'up', responseTime: await this.pingMongo() };
  }

  private async checkRedis() {
    const start = Date.now();
    await this.cacheManager.set('health:ping', 'pong', 5);
    const val = await this.cacheManager.get('health:ping');
    if (val !== 'pong') throw new Error('Redis ping failed');
    return { status: 'up', responseTime: `${Date.now() - start}ms` };
  }

  private async pingMongo(): Promise<string> {
    const start = Date.now();
    await this.mongoConnection.db.command({ ping: 1 });
    return `${Date.now() - start}ms`;
  }
}
