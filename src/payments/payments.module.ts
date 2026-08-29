import { Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants/merchants.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SessionsModule } from '../sessions/sessions.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { ProviderModule } from './provider/provider.module';

/**
 * Settlement: turns a session into a real transaction through whichever provider
 * ProviderModule selected, and owns reconciliation/refund state.
 */
@Module({
  imports: [MerchantsModule, RealtimeModule, NotificationsModule, SessionsModule, ProviderModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  // ProviderModule is re-exported so webhook handling can reach the active provider
  // without knowing which one it is.
  exports: [PaymentsService, ProviderModule],
})
export class PaymentsModule {}
