import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerMiddleware } from './core/common/logger.middleware';
import { validateEnv } from './core/config/env.validation';
import { CoreModule } from './core/core.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MerchantsModule } from './merchants/merchants.module';
import { SessionsModule } from './sessions/sessions.module';
import { PaymentsModule } from './payments/payments.module';
import { RequestsModule } from './requests/requests.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { RealtimeModule } from './realtime/realtime.module';
import { NotificationsModule } from './notifications/notifications.module';
import { HealthModule } from './health/health.module';

/**
 * Composition root. `CoreModule` carries the cross-cutting infrastructure (database,
 * audit); everything else is a feature module owning one slice of the domain.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Global baseline rate limit (10 req / 10s per IP). Tighter limits are applied per-route.
    ThrottlerModule.forRoot([{ ttl: 10_000, limit: 10 }]),
    CoreModule,
    AuthModule,
    UsersModule,
    MerchantsModule,
    NotificationsModule,
    RealtimeModule,
    SessionsModule,
    PaymentsModule,
    RequestsModule,
    WebhooksModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Express 5 / path-to-regexp v8 requires a named wildcard (bare '*' is deprecated).
    consumer.apply(LoggerMiddleware).forRoutes('{*path}');
  }
}
