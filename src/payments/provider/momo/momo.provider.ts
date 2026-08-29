import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  InitPaymentInput,
  InitPaymentResult,
  PAYER_PHONE_REQUIRED,
  PayerActionRequiredError,
  PaymentProvider,
  ProviderTxnStatus,
  RefundInput,
  RefundResult,
  VerifyPaymentResult,
  WebhookEvent,
} from '../payment-provider.interface';
import { MomoClient } from './momo-client';
import { MomoRequestToPayStatus } from './momo.types';
import { momoReferenceFor, normalizeGhanaMsisdn, toMajorUnits, toMinorUnits } from './momo-format';

/**
 * MTN Mobile Money (Ghana) — Collection API.
 *
 * Unlike a hosted checkout, MoMo is a *push* flow: `requesttopay` returns 202 with an
 * empty body and MTN prompts the payer on their handset. There is no URL to open, so
 * `initializePayment` reports `kind: 'push'` and the client waits and polls.
 *
 * Two things this provider deliberately does not trust:
 *  - the one-shot callback (unsigned, never retried) — treated as a hint to re-verify;
 *  - MoMo's amount strings — converted digit-wise, never through floating point.
 */
@Injectable()
export class MomoProvider implements PaymentProvider {
  readonly name = 'momo';
  private readonly logger = new Logger(MomoProvider.name);
  private readonly client: MomoClient;
  private readonly callbackUrl?: string;

  /**
   * MoMo's sandbox settles only in EUR, so a GHS-priced session cannot be tested there
   * unless the currency is swapped on the way out and swapped back on the way in.
   * Honoured only when the target environment is literally `sandbox`; production always
   * charges — and reports — the transaction's real currency.
   */
  private readonly sandboxCurrency?: string;
  private readonly sandboxReportsAs: string;

  constructor(config: ConfigService) {
    this.client = new MomoClient(config);
    this.callbackUrl = config.get<string>('MOMO_CALLBACK_URL');
    const configured = config.get<string>('MOMO_SANDBOX_CURRENCY');
    this.sandboxCurrency =
      this.client.isSandbox && configured ? configured.trim().toUpperCase() : undefined;
    this.sandboxReportsAs = (config.get<string>('MOMO_SANDBOX_AS_CURRENCY') ?? 'GHS')
      .trim()
      .toUpperCase();
    if (this.sandboxCurrency) {
      this.logger.warn(
        `MoMo sandbox: charging in ${this.sandboxCurrency}, reconciling as ${this.sandboxReportsAs}`,
      );
    }
  }

  /**
   * Push a payment prompt to the payer's phone. Returns as soon as MTN accepts the
   * request (202) — approval happens out of band, on the handset.
   */
  async initializePayment(input: InitPaymentInput): Promise<InitPaymentResult> {
    if (!input.payerPhone) {
      throw new PayerActionRequiredError(
        'Add your MTN mobile number to your TapPay profile to pay with MoMo',
        PAYER_PHONE_REQUIRED,
      );
    }
    let msisdn: string;
    try {
      msisdn = normalizeGhanaMsisdn(input.payerPhone);
    } catch {
      throw new PayerActionRequiredError(
        `${input.payerPhone} is not a Ghanaian mobile number — update it in your profile`,
        PAYER_PHONE_REQUIRED,
      );
    }
    const momoReference = momoReferenceFor(input.reference);
    const currency = this.sandboxCurrency ?? input.currency.toUpperCase();

    const headers: Record<string, string> = {
      'X-Reference-Id': momoReference,
      'Content-Type': 'application/json',
    };
    // MTN only delivers callbacks to the host registered with the API user; without one
    // we fall back to polling, which happens anyway.
    const callbackUrl = this.callbackUrl ?? input.callbackUrl;
    if (callbackUrl) headers['X-Callback-Url'] = callbackUrl;

    const body = {
      amount: toMajorUnits(input.amount, currency),
      currency,
      externalId: input.reference,
      payer: { partyIdType: 'MSISDN', partyId: msisdn },
      payerMessage: 'TapPay payment',
      payeeNote: 'TapPay',
    };

    try {
      await this.client.post('/collection/v1_0/requesttopay', body, headers);
      this.logger.log(`Requested MoMo payment ${input.reference} (${momoReference}) from ${msisdn}`);
    } catch (err) {
      // The reference is derived from ours, so a conflict means this exact payment was
      // already pushed — the prompt is on the payer's phone either way.
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        this.logger.warn(`MoMo request ${input.reference} already exists; treating as pending`);
      } else {
        throw err;
      }
    }

    return {
      kind: 'push',
      instruction:
        'Approve the payment prompt on your MTN phone. If you miss it, dial *170# → 6 (Wallet) → 3 (My Approvals).',
      providerReference: momoReference,
      raw: { momoReference, msisdn, ...body },
    };
  }

  /** Authoritative status check — the only thing that may settle a MoMo payment. */
  async verifyPayment(reference: string): Promise<VerifyPaymentResult> {
    const momoReference = momoReferenceFor(reference);
    const txn = await this.client.get<MomoRequestToPayStatus>(
      `/collection/v1_0/requesttopay/${momoReference}`,
    );

    const status: ProviderTxnStatus =
      txn.status === 'SUCCESSFUL' ? 'success' : txn.status === 'FAILED' ? 'failed' : 'pending';
    if (status === 'failed') {
      this.logger.warn(`MoMo payment ${reference} failed: ${JSON.stringify(txn.reason ?? {})}`);
    }

    // Sandbox charges land back as EUR; report them as the currency TapPay booked, or a
    // good payment would look like a currency mismatch and be marked failed.
    const wire = (txn.currency ?? '').toUpperCase();
    const currency = this.sandboxCurrency && wire === this.sandboxCurrency ? this.sandboxReportsAs : wire;

    return {
      status,
      amount: toMinorUnits(txn.amount, wire),
      currency,
      reference: txn.externalId ?? reference,
      raw: txn,
    };
  }

  /**
   * Refunds are not part of the Collection product — MTN exposes them through
   * Disbursements, which needs its own subscription and a funded disbursement account.
   * Failing loudly beats reporting a refund that never moves money.
   */
  async refundPayment(_input: RefundInput): Promise<RefundResult> {
    throw new Error(
      'MTN MoMo refunds require the Disbursement product; refund this payment from the MoMo merchant portal',
    );
  }

  /**
   * MoMo callbacks carry no signature and are sent exactly once, with no retries. The
   * ping is therefore accepted only as a nudge to re-verify: the reference must look
   * like one of ours, and nothing in the payload is trusted — the caller re-reads the
   * status from MTN before changing any state.
   */
  parseWebhook(rawBody: Buffer, _signature: string | undefined): WebhookEvent | null {
    try {
      const event = JSON.parse(rawBody.toString('utf8')) as Partial<MomoRequestToPayStatus>;
      const reference = event?.externalId;
      if (typeof reference !== 'string' || !/^tap_[a-f0-9]{20}$/.test(reference)) {
        this.logger.warn('Discarded MoMo callback with no recognisable reference');
        return null;
      }
      return { reference, kind: 'charge' };
    } catch {
      return null;
    }
  }
}
