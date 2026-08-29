import { Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants/merchants.module';
import { SessionService } from './session.service';
import { SessionController } from './session.controller';

/**
 * Tap/QR payment sessions — the signed hand-off between two devices. Deliberately
 * independent of the payments module: a session is only an *intent* to be paid, and
 * carries no provider knowledge, so it stays valid whichever provider settles it.
 */
@Module({
  imports: [MerchantsModule],
  providers: [SessionService],
  controllers: [SessionController],
  exports: [SessionService],
})
export class SessionsModule {}
