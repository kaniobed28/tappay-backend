import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PaystackProvider } from '../src/payments/provider/paystack.provider';

const SECRET = 'sk_test_dummy_secret';

function makeProvider() {
  const config = {
    get: (key: string) => (key === 'PAYSTACK_SECRET_KEY' ? SECRET : undefined),
  } as unknown as ConfigService;
  return new PaystackProvider(config);
}

function sign(body: Buffer) {
  return crypto.createHmac('sha512', SECRET).update(body).digest('hex');
}

describe('PaystackProvider.parseWebhook', () => {
  const provider = makeProvider();

  it('accepts a correctly signed payload and returns the reference', () => {
    const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'tap_123' } }));
    const result = provider.parseWebhook(body, sign(body));
    expect(result).toEqual({ reference: 'tap_123' });
  });

  it('rejects a payload with an invalid signature', () => {
    const body = Buffer.from(JSON.stringify({ data: { reference: 'tap_123' } }));
    expect(provider.parseWebhook(body, 'deadbeef')).toBeNull();
  });

  it('rejects a payload with a tampered body (signature no longer matches)', () => {
    const original = Buffer.from(JSON.stringify({ data: { reference: 'tap_123' } }));
    const signature = sign(original);
    const tampered = Buffer.from(JSON.stringify({ data: { reference: 'tap_HACKED' } }));
    expect(provider.parseWebhook(tampered, signature)).toBeNull();
  });

  it('rejects when the signature header is missing', () => {
    const body = Buffer.from(JSON.stringify({ data: { reference: 'tap_123' } }));
    expect(provider.parseWebhook(body, undefined)).toBeNull();
  });

  it('returns null when a validly-signed payload has no reference', () => {
    const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: {} }));
    expect(provider.parseWebhook(body, sign(body))).toBeNull();
  });
});
