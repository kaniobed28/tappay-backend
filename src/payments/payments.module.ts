import { Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants/merchants.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SessionService } from './sessions/session.service';
import { SessionController } from './sessions/session.controller';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaystackProvider } from './provider/paystack.provider';
import { PAYMENT_PROVIDER } from './provider/payment-provider.interface';

@Module({
  imports: [MerchantsModule, RealtimeModule, NotificationsModule],
  controllers: [SessionController, PaymentsController],
  providers: [
    SessionService,
    PaymentsService,
    // Default provider binding. Swap this to change payment processors.
    { provide: PAYMENT_PROVIDER, useClass: PaystackProvider },
  ],
  exports: [PaymentsService, PAYMENT_PROVIDER],
})
export class PaymentsModule {}
