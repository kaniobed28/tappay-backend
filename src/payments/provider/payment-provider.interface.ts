/**
 * Provider-agnostic payment abstraction. TapPay only ever talks to this interface;
 * `PaystackProvider` is the default binding. Swap providers by binding a different
 * implementation to the `PAYMENT_PROVIDER` token in PaymentsModule.
 */

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface InitPaymentInput {
  reference: string;
  amount: number; // minor units (pesewas / kobo)
  currency: string;
  email: string; // customer email (required by most providers)
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface InitPaymentResult {
  authorizationUrl: string; // where the customer completes payment
  providerReference: string;
  raw: unknown;
}

export type ProviderTxnStatus = 'success' | 'failed' | 'pending';

export interface VerifyPaymentResult {
  status: ProviderTxnStatus;
  amount: number; // minor units, as reported by the provider
  currency: string;
  reference: string;
  raw: unknown;
}

export interface RefundInput {
  reference: string;
  amount?: number; // minor units; omit for a full refund
  reason?: string;
}

export type RefundStatus = 'processed' | 'pending' | 'failed';

export interface RefundResult {
  status: RefundStatus;
  raw: unknown;
}

/** A verified webhook event, normalized across providers. */
export interface WebhookEvent {
  reference: string;
  kind: 'charge' | 'refund';
}

export interface PaymentProvider {
  readonly name: string;

  /** Start a checkout and return a URL the customer completes payment at. */
  initializePayment(input: InitPaymentInput): Promise<InitPaymentResult>;

  /** Authoritatively check a transaction's outcome with the provider. */
  verifyPayment(reference: string): Promise<VerifyPaymentResult>;

  /** Refund a (previously successful) transaction, fully or partially. */
  refundPayment(input: RefundInput): Promise<RefundResult>;

  /**
   * Validate a webhook payload's authenticity (e.g. HMAC signature) and, if valid,
   * return the normalized event it concerns. Returns null when invalid.
   */
  parseWebhook(rawBody: Buffer, signature: string | undefined): WebhookEvent | null;
}
