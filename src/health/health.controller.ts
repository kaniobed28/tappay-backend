import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';

@SkipThrottle()
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  health() {
    return { status: 'ok', service: 'tappay-backend', time: new Date().toISOString() };
  }
}
