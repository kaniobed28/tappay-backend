import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(80)
  displayName?: string;

  @IsOptional() @IsString()
  photoUrl?: string;
}

export class RegisterDeviceDto {
  @IsString()
  deviceId!: string;

  @IsOptional() @IsString()
  platform?: string;

  @IsOptional() @IsString()
  pushToken?: string;
}
