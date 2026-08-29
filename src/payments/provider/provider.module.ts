import { Module, Provider, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment-provider.interface';
import { MomoProvider } from './momo/momo.provider';
import { PaystackProvider } from './paystack/paystack.provider';

/**
 * Every payment provider TapPay can settle through. Adding one means adding a class
 * here — nothing outside this folder learns its name.
 */
const REGISTRY = [MomoProvider, PaystackProvider] as const;

/** Used when `PAYMENT_PROVIDER` is unset. TapPay is a Ghanaian app; MoMo is the norm. */
const DEFAULT_PROVIDER = 'momo';

/**
 * Binds `PAYMENT_PROVIDER` to the implementation it names. Every candidate is constructed
 * through Nest DI, so providers may depend on any injectable; only the selected one is
 * ever called.
 */
const paymentProviderFactory: Provider = {
  provide: PAYMENT_PROVIDER,
  inject: [ConfigService, ...REGISTRY],
  useFactory: (config: ConfigService, ...candidates: PaymentProvider[]): PaymentProvider => {
    const requested = (config.get<string>('PAYMENT_PROVIDER') ?? DEFAULT_PROVIDER)
      .trim()
      .toLowerCase();
    const selected = candidates.find((p) => p.name === requested);
    if (!selected) {
      const known = candidates.map((p) => p.name).join(', ');
      throw new Error(`Unknown PAYMENT_PROVIDER "${requested}". Known providers: ${known}`);
    }
    Logger.log(`Payment provider: ${selected.name}`, 'ProviderModule');
    return selected;
  },
};

@Module({
  imports: [ConfigModule],
  providers: [...REGISTRY, paymentProviderFactory],
  exports: [PAYMENT_PROVIDER],
})
export class ProviderModule {}
