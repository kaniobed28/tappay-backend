/**
 * Phone numbers are stored in E.164 (`+233…`), matching what Firebase hands us for
 * phone sign-ins, so a number typed by hand and one from auth are the same string.
 */

/** Ghanaian mobile numbers as people write them: 024…, 233…, +233…, with any spacing. */
export function toE164Ghana(raw: string): string {
  const digits = raw.replace(/[\s()-]/g, '').replace(/^\+/, '');
  if (!/^\d+$/.test(digits)) throw new Error('Not a phone number');
  if (/^233\d{9}$/.test(digits)) return `+${digits}`;
  if (/^0\d{9}$/.test(digits)) return `+233${digits.slice(1)}`;
  if (/^\d{9}$/.test(digits)) return `+233${digits}`;
  throw new Error('Not a Ghanaian mobile number');
}
