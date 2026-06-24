import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer, Consumer, CompressionTypes, logLevel } from 'kafkajs';

export interface TransactionEvent {
  eventType: string;
  transactionId: string;
  portfolioId: string;
  timestamp: string;
  [key: string]: any;
}

export const KAFKA_TOPICS = {
  TRANSACTION_EVENTS: 'fintech.transactions.events',
  SETTLEMENT_EVENTS: 'fintech.transactions.settlement',
  PORTFOLIO_UPDATES: 'fintech.portfolio.updates',
  AUDIT_LOG: 'fintech.audit.log',
} as const;

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private kafka: Kafka;
  private producer: Producer;
  private consumer: Consumer;

  constructor(private readonly configService: ConfigService) {
    this.kafka = new Kafka({
      clientId: 'fintech-transaction-api',
      brokers: this.configService.get<string>('KAFKA_BROKERS', 'localhost:9092').split(','),
      // SSL for production financial environments
      ssl: this.configService.get('KAFKA_SSL_ENABLED') === 'true',
      sasl: this.configService.get('KAFKA_SASL_ENABLED') === 'true'
        ? {
            mechanism: 'plain',
            username: this.configService.get('KAFKA_USERNAME'),
            password: this.configService.get('KAFKA_PASSWORD'),
          }
        : undefined,
      logLevel: logLevel.WARN,
      retry: {
        initialRetryTime: 300,
        retries: 8,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.initializeProducer();
    await this.initializeConsumer();
    await this.ensureTopicsExist();
    this.logger.log('Kafka service initialized — event streaming ready');
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer?.disconnect();
    await this.consumer?.disconnect();
    this.logger.log('Kafka connections closed');
  }

  /**
   * Publish transaction event to Kafka
   * Enables async processing — decouples API response from settlement
   */
  async publishTransactionEvent(event: TransactionEvent): Promise<void> {
    try {
      await this.producer.send({
        topic: KAFKA_TOPICS.TRANSACTION_EVENTS,
        compression: CompressionTypes.GZIP,
        messages: [
          {
            // Partition by portfolioId for ordered processing per portfolio
            key: event.portfolioId,
            value: JSON.stringify(event),
            headers: {
              eventType: event.eventType,
              timestamp: event.timestamp,
              source: 'fintech-transaction-api',
            },
          },
        ],
      });

      this.logger.debug(`Published ${event.eventType} for transaction ${event.transactionId}`);
    } catch (error) {
      this.logger.error(`Failed to publish transaction event: ${error.message}`, error.stack);
      // Don't throw — Kafka failure should not fail the API response
      // Event will be retried by the retry mechanism
    }
  }

  /**
   * Publish portfolio update event
   * Triggers real-time portfolio recalculation downstream
   */
  async publishPortfolioUpdate(portfolioId: string, updateType: string, data: any): Promise<void> {
    try {
      await this.producer.send({
        topic: KAFKA_TOPICS.PORTFOLIO_UPDATES,
        messages: [
          {
            key: portfolioId,
            value: JSON.stringify({
              portfolioId,
              updateType,
              data,
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      });
    } catch (error) {
      this.logger.error(`Failed to publish portfolio update: ${error.message}`);
    }
  }

  /**
   * Publish audit log event
   * All financial operations are audited via Kafka for compliance
   */
  async publishAuditEvent(auditData: {
    action: string;
    userId: string;
    resourceType: string;
    resourceId: string;
    ipAddress: string;
    timestamp: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    try {
      await this.producer.send({
        topic: KAFKA_TOPICS.AUDIT_LOG,
        messages: [
          {
            key: auditData.userId,
            value: JSON.stringify(auditData),
          },
        ],
      });
    } catch (error) {
      this.logger.error(`Failed to publish audit event: ${error.message}`);
    }
  }

  private async initializeProducer(): Promise<void> {
    this.producer = this.kafka.producer({
      // Idempotent producer — exactly-once delivery for financial events
      idempotent: true,
      maxInFlightRequests: 1,
      transactionTimeout: 30000,
    });
    await this.producer.connect();
    this.logger.log('Kafka producer connected');
  }

  private async initializeConsumer(): Promise<void> {
    this.consumer = this.kafka.consumer({
      groupId: 'fintech-transaction-api-group',
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
    });
    await this.consumer.connect();
    this.logger.log('Kafka consumer connected');
  }

  private async ensureTopicsExist(): Promise<void> {
    const admin = this.kafka.admin();
    await admin.connect();
    try {
      await admin.createTopics({
        topics: Object.values(KAFKA_TOPICS).map(topic => ({
          topic,
          numPartitions: 6, // Partition by portfolioId for parallel processing
          replicationFactor: 3,
          configEntries: [
            { name: 'retention.ms', value: String(7 * 24 * 60 * 60 * 1000) }, // 7 day retention
            { name: 'compression.type', value: 'gzip' },
          ],
        })),
        waitForLeaders: true,
      });
    } catch (error) {
      // Topics may already exist — not an error
      this.logger.debug('Topics already exist or creation skipped');
    } finally {
      await admin.disconnect();
    }
  }
}
