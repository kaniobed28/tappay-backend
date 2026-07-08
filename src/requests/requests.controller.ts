import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RequestsService } from './requests.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '@prisma/client';
import { CreateRequestDto } from './dto';

@Controller('payments/requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  /** Ask a known user (by email/phone) to pay you. */
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateRequestDto) {
    return this.requests.create(user, dto);
  }

  /** Requests I've been asked to pay. */
  @Get('incoming')
  incoming(@CurrentUser() user: User) {
    return this.requests.incoming(user);
  }

  /** Requests I've sent out. */
  @Get('outgoing')
  outgoing(@CurrentUser() user: User) {
    return this.requests.outgoing(user);
  }

  /** Payer declines a pending request. */
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post(':id/decline')
  decline(@CurrentUser() user: User, @Param('id') id: string) {
    return this.requests.decline(user, id);
  }

  /** Requester withdraws a pending request. */
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post(':id/cancel')
  cancel(@CurrentUser() user: User, @Param('id') id: string) {
    return this.requests.cancel(user, id);
  }

  /** Payer settles a pending request via the standard checkout flow. */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post(':id/pay')
  pay(@CurrentUser() user: User, @Param('id') id: string) {
    return this.requests.pay(user, id);
  }
}
