import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { PaymentsService } from '../payments/payments.service';
import { PAYMENT_PROVIDER, PaymentProvider } from '../payments/provider';

// Provider webhooks arrive in bursts from a small set of IPs — never rate-limit them.
@SkipThrottle()
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly payments: PaymentsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * Provider -> backend confirmation, one route per provider name (`/webhooks/paystack`,
   * `/webhooks/momo`). The provider verifies the payload however it can, and we then
   * reconcile authoritatively against it — the payload's own status is never trusted, so
   * a provider with unsigned callbacks (mobile money) is still safe. Always 200 so the
   * provider doesn't spam retries once received.
   */
  @Public()
  @Post(':provider')
  @HttpCode(200)
  async receive(
    @Param('provider') provider: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-paystack-signature') paystackSignature?: string,
    @Headers('x-signature') genericSignature?: string,
  ) {
    // Ignore callbacks addressed to a provider that isn't the active one: their payloads
    // would be parsed by the wrong verifier.
    if (provider.toLowerCase() !== this.provider.name) {
      this.logger.warn(`Ignored webhook for inactive provider "${provider}"`);
      return { received: true };
    }

    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const parsed = this.provider.parseWebhook(rawBody, paystackSignature ?? genericSignature);
    if (!parsed) {
      this.logger.warn('Discarded invalid/unsigned webhook');
      return { received: true };
    }

    try {
      if (parsed.kind === 'refund') {
        await this.payments.markRefunded(parsed.reference);
      } else {
        await this.payments.reconcile(parsed.reference);
      }
    } catch (err) {
      this.logger.error(`Webhook handling failed for ${parsed.reference}: ${(err as Error).message}`);
    }
    return { received: true };
  }
}
