import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import {
  InitPaymentInput,
  InitPaymentResult,
  PaymentProvider,
  RefundInput,
  RefundResult,
  VerifyPaymentResult,
  WebhookEvent,
} from './payment-provider.interface';

@Injectable()
export class PaystackProvider implements PaymentProvider {
  readonly name = 'paystack';
  private readonly logger = new Logger(PaystackProvider.name);
  private readonly http: AxiosInstance;
  private readonly secretKey: string;

  constructor(private readonly config: ConfigService) {
    this.secretKey = this.config.get<string>('PAYSTACK_SECRET_KEY') ?? '';
    this.http = axios.create({
      baseURL: this.config.get<string>('PAYSTACK_BASE_URL') ?? 'https://api.paystack.co',
      headers: { Authorization: `Bearer ${this.secretKey}` },
      timeout: 15000,
    });
  }

  async initializePayment(input: InitPaymentInput): Promise<InitPaymentResult> {
    const { data } = await this.http.post('/transaction/initialize', {
      reference: input.reference,
      amount: input.amount, // Paystack expects minor units
      currency: input.currency,
      email: input.email,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
    });

    if (!data?.status) {
      throw new Error(data?.message ?? 'Paystack initialization failed');
    }
    return {
      authorizationUrl: data.data.authorization_url,
      providerReference: data.data.reference,
      raw: data.data,
    };
  }

  async verifyPayment(reference: string): Promise<VerifyPaymentResult> {
    const { data } = await this.http.get(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (!data?.status) {
      throw new Error(data?.message ?? 'Paystack verification failed');
    }
    const txn = data.data;
    const status =
      txn.status === 'success' ? 'success' : txn.status === 'failed' ? 'failed' : 'pending';
    return {
      status,
      amount: txn.amount,
      currency: txn.currency,
      reference: txn.reference,
      raw: txn,
    };
  }

  async refundPayment(input: RefundInput): Promise<RefundResult> {
    const { data } = await this.http.post('/refund', {
      transaction: input.reference,
      amount: input.amount, // omit for a full refund
      merchant_note: input.reason,
    });
    if (!data?.status) {
      throw new Error(data?.message ?? 'Paystack refund failed');
    }
    // Paystack refunds are typically async: 'pending' now, 'processed' via webhook.
    const raw = data.data;
    const status: RefundResult['status'] =
      raw?.status === 'processed' ? 'processed' : raw?.status === 'failed' ? 'failed' : 'pending';
    return { status, raw };
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): WebhookEvent | null {
    if (!signature || !this.secretKey) return null;
    const expected = crypto
      .createHmac('sha512', this.secretKey)
      .update(rawBody)
      .digest('hex');
    // constant-time compare
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      this.logger.warn('Rejected webhook with invalid signature');
      return null;
    }
    try {
      const event = JSON.parse(rawBody.toString('utf8'));
      const eventName: string = event?.event ?? '';
      if (eventName.startsWith('refund')) {
        // Refund events carry the original transaction reference in a different field.
        const reference =
          event?.data?.transaction_reference ?? event?.data?.transaction?.reference;
        if (!reference) return null;
        return { reference, kind: 'refund' };
      }
      const reference = event?.data?.reference;
      if (!reference) return null;
      return { reference, kind: 'charge' };
    } catch {
      return null;
    }
  }
}
