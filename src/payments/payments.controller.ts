import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PaymentsService } from './payments.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '@prisma/client';
import { PayDto } from './dto';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Customer confirms a session and starts checkout. */
  @Throttle({ default: { ttl: 60_000, limit: 10 } }) // max 10 payment inits/min per IP
  @Post()
  pay(@CurrentUser() user: User, @Body() dto: PayDto) {
    return this.payments.payFromSession(user, dto.sessionId);
  }

  /** History for the authenticated user (sent + received). */
  @Get()
  history(@CurrentUser() user: User, @Query('take') take?: string) {
    return this.payments.history(user, take ? Number(take) : undefined);
  }

  /** Poll a single transaction; forces a provider reconcile so status is authoritative. */
  @Get(':id')
  async getOne(@CurrentUser() user: User, @Param('id') id: string) {
    const txn = await this.payments.getForUser(user, id);
    if (txn.status === 'PENDING' || txn.status === 'INITIALIZED') {
      return this.payments.reconcile(txn.reference);
    }
    return txn;
  }
}
