/**
 * Provider-agnostic payment abstraction. TapPay only ever talks to this interface;
 * concrete providers live in sibling folders and are selected by `ProviderModule`
 * from the `PAYMENT_PROVIDER` env var.
 */

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface InitPaymentInput {
  reference: string;
  amount: number; // minor units (pesewas / kobo)
  currency: string;
  email: string; // customer email (required by most providers)
  payerPhone?: string | null; // customer MSISDN — required by mobile-money providers
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

/**
 * How the payer completes the payment:
 * - `redirect` — they finish on a hosted checkout page (card/bank, e.g. Paystack).
 * - `push`     — the provider pushes an approval prompt to their phone and there is
 *                nothing to open (mobile money, e.g. MTN MoMo). The client waits and
 *                polls instead.
 */
export type CheckoutKind = 'redirect' | 'push';

export interface InitPaymentResult {
  kind: CheckoutKind;
  /** Where the customer completes payment. Always set for `redirect`, never for `push`. */
  authorizationUrl?: string;
  /** What to tell the payer while they complete a `push` payment. */
  instruction?: string;
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
  /** Value of `PAYMENT_PROVIDER` that selects this implementation. */
  readonly name: string;

  /** Start a payment. Either returns a checkout URL or pushes a prompt to the payer. */
  initializePayment(input: InitPaymentInput): Promise<InitPaymentResult>;

  /** Authoritatively check a transaction's outcome with the provider. */
  verifyPayment(reference: string): Promise<VerifyPaymentResult>;

  /** Refund a (previously successful) transaction, fully or partially. */
  refundPayment(input: RefundInput): Promise<RefundResult>;

  /**
   * Validate a webhook payload's authenticity (e.g. HMAC signature) and, if valid,
   * return the normalized event it concerns. Returns null when invalid.
   *
   * Providers that cannot authenticate their callbacks (mobile money) may accept an
   * unsigned ping — safe only because the caller re-verifies with `verifyPayment`
   * and never trusts the payload's own status.
   */
  parseWebhook(rawBody: Buffer, signature: string | undefined): WebhookEvent | null;
}

/**
 * Raised when a payment cannot start until the payer fixes something themselves —
 * no mobile number on file, an unusable one, and so on. The message is written for the
 * payer and is safe to surface; every other provider failure stays internal.
 */
export class PayerActionRequiredError extends Error {
  /**
   * Machine-readable reason, so the client can offer the fix (e.g. ask for a mobile
   * number) instead of only showing the text.
   */
  constructor(
    message: string,
    readonly code: string = 'payer_action_required',
  ) {
    super(message);
    this.name = 'PayerActionRequiredError';
  }
}

/** The payer has no usable mobile number on file; mobile money cannot charge them. */
export const PAYER_PHONE_REQUIRED = 'payer_phone_required';
