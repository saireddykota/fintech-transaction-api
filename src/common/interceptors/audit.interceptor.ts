import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { KafkaService } from '../../kafka/kafka.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly kafkaService: KafkaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, user, ip, headers } = request;
    const startTime = Date.now();

    const auditData = {
      action: `${method} ${url}`,
      userId: user?.userId || 'anonymous',
      resourceType: this.extractResourceType(url),
      resourceId: this.extractResourceId(url),
      ipAddress: ip || headers['x-forwarded-for'],
      userAgent: headers['user-agent'],
      timestamp: new Date().toISOString(),
    };

    return next.handle().pipe(
      tap((response) => {
        const duration = Date.now() - startTime;
        // Publish audit event to Kafka for compliance logging
        this.kafkaService.publishAuditEvent({
          ...auditData,
          metadata: {
            statusCode: 200,
            duration,
            responseSize: JSON.stringify(response || {}).length,
          },
        }).catch(err => this.logger.error('Audit log failed', err));
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        this.kafkaService.publishAuditEvent({
          ...auditData,
          metadata: {
            statusCode: error.status || 500,
            duration,
            errorMessage: error.message,
          },
        }).catch(err => this.logger.error('Audit log failed', err));
        return throwError(() => error);
      }),
    );
  }

  private extractResourceType(url: string): string {
    const parts = url.split('/').filter(Boolean);
    return parts[1] || 'unknown';
  }

  private extractResourceId(url: string): string {
    const parts = url.split('/').filter(Boolean);
    return parts[2] || 'collection';
  }
}
