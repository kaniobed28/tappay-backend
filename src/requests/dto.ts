import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateRequestDto {
  /** The person to ask for money, identified by their email or phone. */
  @IsString() @MaxLength(160)
  target!: string;

  /** Amount in minor units (pesewas / kobo). */
  @IsInt() @Min(1)
  amount!: number;

  @IsOptional() @IsString() @MaxLength(140)
  note?: string;
}
