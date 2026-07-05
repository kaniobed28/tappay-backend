import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { PaymentsService } from '../payments/payments.service';
import { PAYMENT_PROVIDER, PaymentProvider } from '../payments/provider/payment-provider.interface';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly payments: PaymentsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * Provider -> backend confirmation. We verify the signature over the RAW body,
   * then reconcile authoritatively against the provider (never trust the payload's
   * status field directly). Always 200 so the provider doesn't spam retries once received.
   */
  @Public()
  @Post('paystack')
  @HttpCode(200)
  async paystack(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-paystack-signature') signature?: string,
  ) {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const parsed = this.provider.parseWebhook(rawBody, signature);
    if (!parsed) {
      this.logger.warn('Discarded invalid/unsigned webhook');
      return { received: true };
    }

    try {
      await this.payments.reconcile(parsed.reference);
    } catch (err) {
      this.logger.error(`Webhook reconcile failed for ${parsed.reference}: ${(err as Error).message}`);
    }
    return { received: true };
  }
}
