import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class PayDto {
  @IsString()
  sessionId!: string;
}

export class RefundDto {
  /** Optional partial-refund amount in minor units; omit for a full refund. */
  @IsOptional() @IsInt() @Min(1)
  amount?: number;

  @IsOptional() @IsString() @MaxLength(140)
  reason?: string;
}
