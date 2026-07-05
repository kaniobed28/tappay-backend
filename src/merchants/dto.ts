import { IsOptional, IsString, Length } from 'class-validator';

export class RegisterMerchantDto {
  @IsString() @Length(2, 80)
  businessName!: string;

  @IsOptional() @IsString()
  category?: string;

  @IsOptional() @IsString() @Length(3, 3)
  currency?: string;
}
