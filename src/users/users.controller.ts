import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '@prisma/client';
import { RegisterDeviceDto, UpdateProfileDto } from './dto';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: User) {
    return user;
  }

  @Patch('me')
  updateProfile(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto);
  }

  @Post('me/devices')
  registerDevice(@CurrentUser() user: User, @Body() dto: RegisterDeviceDto) {
    return this.users.registerDevice(user.id, dto.deviceId, dto.platform, dto.pushToken);
  }
}
