import * as crypto from 'crypto';

/**
 * Conversions between TapPay's internal representation and what the MTN MoMo
 * Collection API expects. Kept free of I/O so they can be tested exhaustively —
 * every one of them is a place where a silent mistake becomes a wrong charge.
 */

/** Minor units per major unit, by ISO currency. MoMo's African currencies are all 2dp. */
const DECIMALS: Record<string, number> = { GHS: 2, EUR: 2, UGX: 0, RWF: 0, XAF: 0, XOF: 0 };

function decimalsFor(currency: string): number {
  return DECIMALS[currency.toUpperCase()] ?? 2;
}

/**
 * Minor units -> the decimal string MoMo wants ("2500" pesewas -> "25.00").
 * TapPay stores money as integer minor units; MoMo takes and returns major-unit strings.
 */
export function toMajorUnits(minor: number, currency: string): string {
  if (!Number.isInteger(minor)) throw new Error(`Amount must be an integer in minor units: ${minor}`);
  const d = decimalsFor(currency);
  if (d === 0) return String(minor);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor).toString().padStart(d + 1, '0');
  return `${sign}${abs.slice(0, -d)}.${abs.slice(-d)}`;
}

/**
 * MoMo's major-unit string -> minor units ("25.00" -> 2500). Parsed digit-wise rather
 * than via floating point, so 0.1 + 0.2 style drift can never reach a comparison that
 * decides whether a payment counts as settled.
 */
export function toMinorUnits(major: string | number, currency: string): number {
  const text = String(major).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error(`Unparseable provider amount: ${major}`);
  const d = decimalsFor(currency);
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const padded = (fraction + '0'.repeat(d)).slice(0, d);
  const minor = Number(whole) * 10 ** d + (d === 0 ? 0 : Number(padded));
  return negative ? -minor : minor;
}

/**
 * MoMo identifies a payer by MSISDN in international format with no `+`
 * (Ghana: 233XXXXXXXXX). Accepts the shapes users actually have on file:
 * `024 123 4567`, `+233241234567`, `233241234567`.
 */
export function normalizeGhanaMsisdn(raw: string): string {
  const digits = raw.replace(/[\s()+-]/g, '');
  if (!/^\d+$/.test(digits)) throw new Error(`Not a phone number: ${raw}`);
  if (/^233\d{9}$/.test(digits)) return digits;
  if (/^0\d{9}$/.test(digits)) return `233${digits.slice(1)}`;
  if (/^\d{9}$/.test(digits)) return `233${digits}`; // no leading zero
  throw new Error(`Not a Ghanaian mobile number: ${raw}`);
}

/** Fixed namespace (UUIDv5) for deriving MoMo reference ids from TapPay references. */
const TAPPAY_NAMESPACE = 'f6b1a2c4-6d2e-4a3f-9c1b-0e7d5a8f2b31';

/**
 * MoMo's `X-Reference-Id` must be a UUID, and it is also the id the status endpoint is
 * queried by. Rather than storing a second identifier, derive it deterministically from
 * our own reference: the same payment always maps to the same UUID, so `verifyPayment`
 * can recompute it, and a retried initialize is naturally idempotent on MoMo's side.
 */
export function momoReferenceFor(reference: string): string {
  const ns = Buffer.from(TAPPAY_NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = crypto.createHash('sha1').update(Buffer.concat([ns, Buffer.from(reference, 'utf8')])).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
