import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { SessionChannel } from '@prisma/client';

export class CreateSessionDto {
  /** Amount in minor units (pesewas / kobo). */
  @IsInt() @Min(1)
  amount!: number;

  @IsOptional() @IsString() @MaxLength(140)
  description?: string;

  @IsOptional() @IsEnum(SessionChannel)
  channel?: SessionChannel;
}

export class PayDto {
  @IsString()
  sessionId!: string;
}
