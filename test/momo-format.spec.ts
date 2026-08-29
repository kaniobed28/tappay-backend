import {
  momoReferenceFor,
  normalizeGhanaMsisdn,
  toMajorUnits,
  toMinorUnits,
} from '../src/payments/provider/momo/momo-format';

/**
 * TapPay stores money as integer minor units; MTN MoMo takes and returns major-unit
 * decimal strings. Every conversion below sits between a customer's balance and what we
 * decide they paid, so they are pinned exactly — including the round trip.
 */
describe('MoMo amount conversion', () => {
  it('converts minor units to MoMo major-unit strings', () => {
    expect(toMajorUnits(2500, 'GHS')).toBe('25.00');
    expect(toMajorUnits(5, 'GHS')).toBe('0.05');
    expect(toMajorUnits(70, 'GHS')).toBe('0.70');
    expect(toMajorUnits(100000, 'GHS')).toBe('1000.00');
    expect(toMajorUnits(0, 'GHS')).toBe('0.00');
  });

  it('treats zero-decimal currencies as whole units', () => {
    expect(toMajorUnits(2500, 'UGX')).toBe('2500');
    expect(toMinorUnits('2500', 'UGX')).toBe(2500);
  });

  it('parses MoMo amounts back to minor units without floating point drift', () => {
    expect(toMinorUnits('25.00', 'GHS')).toBe(2500);
    expect(toMinorUnits('0.05', 'GHS')).toBe(5);
    expect(toMinorUnits('0.7', 'GHS')).toBe(70); // MoMo may drop a trailing zero
    expect(toMinorUnits('1000', 'GHS')).toBe(100000); // ...or the decimals entirely
    expect(toMinorUnits(25.1, 'GHS')).toBe(2510);
  });

  it('round-trips every amount in a realistic range', () => {
    for (const minor of [1, 5, 99, 100, 4200, 99999, 1234567]) {
      expect(toMinorUnits(toMajorUnits(minor, 'GHS'), 'GHS')).toBe(minor);
    }
  });

  it('rejects amounts it cannot represent exactly', () => {
    expect(() => toMajorUnits(12.5, 'GHS')).toThrow(/minor units/);
    expect(() => toMinorUnits('twenty', 'GHS')).toThrow(/Unparseable/);
  });
});

describe('Ghanaian MSISDN normalization', () => {
  it('accepts the shapes users actually have on file', () => {
    expect(normalizeGhanaMsisdn('0241234567')).toBe('233241234567');
    expect(normalizeGhanaMsisdn('+233241234567')).toBe('233241234567');
    expect(normalizeGhanaMsisdn('233241234567')).toBe('233241234567');
    expect(normalizeGhanaMsisdn('024 123 4567')).toBe('233241234567');
    expect(normalizeGhanaMsisdn('(024) 123-4567')).toBe('233241234567');
    expect(normalizeGhanaMsisdn('241234567')).toBe('233241234567');
  });

  it('rejects anything that is not a Ghanaian mobile number', () => {
    expect(() => normalizeGhanaMsisdn('12345')).toThrow();
    expect(() => normalizeGhanaMsisdn('+2348012345678')).toThrow(); // Nigeria
    expect(() => normalizeGhanaMsisdn('not-a-number')).toThrow();
  });
});

describe('MoMo reference derivation', () => {
  it('is deterministic, so verify can recompute what initialize sent', () => {
    expect(momoReferenceFor('tap_abc')).toBe(momoReferenceFor('tap_abc'));
  });

  it('is unique per payment', () => {
    expect(momoReferenceFor('tap_abc')).not.toBe(momoReferenceFor('tap_abd'));
  });

  it('produces a valid RFC 4122 v5 UUID, which MoMo requires', () => {
    expect(momoReferenceFor('tap_abc')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
