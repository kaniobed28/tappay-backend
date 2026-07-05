import * as crypto from 'crypto';

export interface SessionSignatureFields {
  id: string;
  merchantId: string;
  amount: number;
  currency: string;
  nonce: string;
  expiresAt: string; // ISO
}

/**
 * Canonical HMAC-SHA256 signature over the immutable session fields. This is what
 * proves an NFC/QR payload was minted by our backend and hasn't been tampered with.
 */
export function signSession(fields: SessionSignatureFields, secret: string): string {
  const canonical = [
    fields.id,
    fields.merchantId,
    fields.amount,
    fields.currency,
    fields.nonce,
    fields.expiresAt,
  ].join('|');
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

export function verifySessionSignature(
  fields: SessionSignatureFields,
  signature: string,
  secret: string,
): boolean {
  const expected = signSession(fields, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
