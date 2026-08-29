import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(80)
  displayName?: string;

  @IsOptional() @IsString()
  photoUrl?: string;

  /**
   * Mobile number, in any shape the user types it — stored in E.164. Needed to pay by
   * mobile money, which charges a phone rather than a card.
   */
  @IsOptional() @IsString() @MaxLength(20)
  phone?: string;
}

export class RegisterDeviceDto {
  @IsString()
  deviceId!: string;

  @IsOptional() @IsString()
  platform?: string;

  @IsOptional() @IsString()
  pushToken?: string;
}
