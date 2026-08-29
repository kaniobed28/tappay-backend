import { signSession, verifySessionSignature, SessionSignatureFields } from '../src/sessions/session-signing';

const SECRET = 'test-signing-secret-please-change';

const fields = (): SessionSignatureFields => ({
  id: 'sess_1',
  merchantId: 'merch_1',
  amount: 3500,
  currency: 'GHS',
  nonce: 'abc123',
  expiresAt: '2026-07-05T00:00:00.000Z',
});

describe('session signing', () => {
  it('verifies a signature it produced', () => {
    const f = fields();
    const sig = signSession(f, SECRET);
    expect(verifySessionSignature(f, sig, SECRET)).toBe(true);
  });

  it('rejects a tampered amount (prevents QR/NFC amount forgery)', () => {
    const f = fields();
    const sig = signSession(f, SECRET);
    const tampered = { ...f, amount: 1 };
    expect(verifySessionSignature(tampered, sig, SECRET)).toBe(false);
  });

  it('rejects a tampered merchant', () => {
    const f = fields();
    const sig = signSession(f, SECRET);
    expect(verifySessionSignature({ ...f, merchantId: 'attacker' }, sig, SECRET)).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    const f = fields();
    const sig = signSession(f, 'other-secret');
    expect(verifySessionSignature(f, sig, SECRET)).toBe(false);
  });

  it('rejects a malformed signature without throwing', () => {
    const f = fields();
    expect(verifySessionSignature(f, 'not-a-real-signature', SECRET)).toBe(false);
  });
});
