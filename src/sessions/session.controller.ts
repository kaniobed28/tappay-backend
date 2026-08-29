import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SessionService } from './session.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '@prisma/client';
import { CreateSessionDto } from './dto';

@Controller('sessions')
export class SessionController {
  constructor(private readonly sessions: SessionService) {}

  /** Merchant: mint a signed session to broadcast via NFC or render as QR. */
  @Throttle({ default: { ttl: 60_000, limit: 30 } }) // max 30 new sessions/min per IP
  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateSessionDto) {
    return this.sessions.create(user.id, dto);
  }

  /** Customer: resolve a tapped/scanned session id (validates signature + expiry). */
  @Get(':id')
  resolve(@Param('id') id: string) {
    return this.sessions.resolve(id);
  }
}
