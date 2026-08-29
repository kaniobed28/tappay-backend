import { Module } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';
import { PaymentsModule } from '../payments/payments.module';
import { SessionsModule } from '../sessions/sessions.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    PaymentsModule,
    SessionsModule,
    MerchantsModule,
    UsersModule,
    NotificationsModule,
    RealtimeModule,
  ],
  controllers: [RequestsController],
  providers: [RequestsService],
})
export class RequestsModule {}
