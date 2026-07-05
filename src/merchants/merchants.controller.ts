import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MerchantsService } from './merchants.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '@prisma/client';
import { RegisterMerchantDto } from './dto';

@Controller('merchants')
export class MerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Post()
  register(@CurrentUser() user: User, @Body() dto: RegisterMerchantDto) {
    return this.merchants.register(user.id, dto);
  }

  @Get('me')
  mine(@CurrentUser() user: User) {
    return this.merchants.getMine(user.id);
  }

  @Get('me/analytics')
  analytics(@CurrentUser() user: User) {
    return this.merchants.analytics(user.id);
  }

  @Get(':id')
  publicView(@Param('id') id: string) {
    return this.merchants.publicView(id);
  }
}
