import axios from 'axios';
import { MomoProvider } from '../src/payments/provider/momo/momo.provider';
import { PayerActionRequiredError } from '../src/payments/provider/payment-provider.interface';
import { momoReferenceFor } from '../src/payments/provider/momo/momo-format';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * MoMo is a push flow: `requesttopay` returns 202 with an empty body and the payer
 * approves on their handset. These tests pin the request TapPay actually sends MTN, and
 * the fact that only a status read — never a callback — can settle a payment.
 */
const ENV: Record<string, string> = {
  MOMO_SUBSCRIPTION_KEY: 'sub_key',
  MOMO_API_USER: 'api-user-uuid',
  MOMO_API_KEY: 'api-key',
  MOMO_TARGET_ENVIRONMENT: 'mtnghana',
  MOMO_BASE_URL: 'https://proxy.momoapi.mtn.com',
};

function makeProvider(handlers: { post?: jest.Mock; get?: jest.Mock }, env = ENV) {
  const post =
    handlers.post ?? jest.fn().mockResolvedValue({ data: { access_token: 't', expires_in: 3600 } });
  const get = handlers.get ?? jest.fn();
  mockedAxios.create.mockReturnValue({ post, get } as any);
  const config = { get: (k: string) => env[k] };
  return { provider: new MomoProvider(config as any), post, get };
}

/** A post mock that answers the token call first, then the requesttopay call. */
function postWithToken(requestToPay: jest.Mock) {
  return jest.fn().mockImplementation((url: string, body: unknown, opts: unknown) => {
    if (url === '/collection/token/') {
      return Promise.resolve({ data: { access_token: 'tok_123', expires_in: 3600 } });
    }
    return requestToPay(url, body, opts);
  });
}

const input = {
  reference: 'tap_0123456789abcdef0123',
  amount: 2500,
  currency: 'GHS',
  email: 'ama@example.com',
  payerPhone: '024 123 4567',
} as any;

describe('MomoProvider.initializePayment', () => {
  it('pushes a prompt to the payer and returns no checkout URL', async () => {
    const requestToPay = jest.fn().mockResolvedValue({ status: 202, data: '' });
    const { provider, post } = makeProvider({ post: postWithToken(requestToPay) });

    const result = await provider.initializePayment(input);

    expect(result.kind).toBe('push');
    expect(result.authorizationUrl).toBeUndefined();
    expect(result.instruction).toContain('*170#');
    expect(result.providerReference).toBe(momoReferenceFor(input.reference));

    const [url, body, opts] = requestToPay.mock.calls[0];
    expect(url).toBe('/collection/v1_0/requesttopay');
    expect(body).toMatchObject({
      amount: '25.00', // minor units -> MoMo's major-unit string
      currency: 'GHS',
      externalId: input.reference,
      payer: { partyIdType: 'MSISDN', partyId: '233241234567' },
    });
    expect(opts.headers['X-Reference-Id']).toBe(momoReferenceFor(input.reference));
    expect(opts.headers['X-Target-Environment']).toBe('mtnghana');
    expect(opts.headers['Ocp-Apim-Subscription-Key']).toBe('sub_key');
    expect(opts.headers.Authorization).toBe('Bearer tok_123');
    // Token minted once and reused, not re-fetched per call.
    expect(post.mock.calls.filter((c: unknown[]) => c[0] === '/collection/token/')).toHaveLength(1);
  });

  it('asks the payer for a phone number instead of failing opaquely', async () => {
    const { provider } = makeProvider({});
    await expect(provider.initializePayment({ ...input, payerPhone: null })).rejects.toBeInstanceOf(
      PayerActionRequiredError,
    );
    await expect(
      provider.initializePayment({ ...input, payerPhone: '+2348012345678' }),
    ).rejects.toBeInstanceOf(PayerActionRequiredError);
  });

  it('treats a duplicate request as the prompt already being on the phone', async () => {
    const conflict = { isAxiosError: true, response: { status: 409 } };
    (mockedAxios.isAxiosError as unknown as jest.Mock).mockImplementation(
      (e: any) => !!e?.isAxiosError,
    );
    const { provider } = makeProvider({ post: postWithToken(jest.fn().mockRejectedValue(conflict)) });

    await expect(provider.initializePayment(input)).resolves.toMatchObject({ kind: 'push' });
  });

  it('propagates real failures', async () => {
    const boom = { isAxiosError: true, response: { status: 500 } };
    (mockedAxios.isAxiosError as unknown as jest.Mock).mockImplementation(
      (e: any) => !!e?.isAxiosError,
    );
    const { provider } = makeProvider({ post: postWithToken(jest.fn().mockRejectedValue(boom)) });

    await expect(provider.initializePayment(input)).rejects.toBe(boom);
  });
});

describe('MomoProvider.verifyPayment', () => {
  const status = (over: Record<string, unknown> = {}) => ({
    data: {
      amount: '25.00',
      currency: 'GHS',
      externalId: input.reference,
      payer: { partyIdType: 'MSISDN', partyId: '233241234567' },
      status: 'SUCCESSFUL',
      ...over,
    },
  });

  it('reads the status by the derived reference and reports minor units', async () => {
    const get = jest.fn().mockResolvedValue(status());
    const { provider } = makeProvider({ get });

    const result = await provider.verifyPayment(input.reference);

    expect(get).toHaveBeenCalledWith(
      `/collection/v1_0/requesttopay/${momoReferenceFor(input.reference)}`,
      expect.anything(),
    );
    expect(result).toMatchObject({
      status: 'success',
      amount: 2500,
      currency: 'GHS',
      reference: input.reference,
    });
  });

  it('maps MoMo statuses onto TapPay outcomes', async () => {
    for (const [momo, expected] of [
      ['SUCCESSFUL', 'success'],
      ['FAILED', 'failed'],
      ['PENDING', 'pending'],
    ] as const) {
      const { provider } = makeProvider({
        get: jest.fn().mockResolvedValue(status({ status: momo })),
      });
      await expect(provider.verifyPayment(input.reference)).resolves.toMatchObject({
        status: expected,
      });
    }
  });

  it('reconciles a sandbox EUR charge back as the booked currency', async () => {
    const sandboxEnv = {
      ...ENV,
      MOMO_TARGET_ENVIRONMENT: 'sandbox',
      MOMO_SANDBOX_CURRENCY: 'EUR',
      MOMO_SANDBOX_AS_CURRENCY: 'GHS',
    };
    const get = jest.fn().mockResolvedValue(status({ currency: 'EUR' }));
    const { provider } = makeProvider({ get }, sandboxEnv);

    // Without the mapping this reads as a currency mismatch and fails a good payment.
    await expect(provider.verifyPayment(input.reference)).resolves.toMatchObject({
      status: 'success',
      amount: 2500,
      currency: 'GHS',
    });
  });

  it('does not rewrite currencies in production', async () => {
    const get = jest.fn().mockResolvedValue(status({ currency: 'EUR' }));
    const { provider } = makeProvider(
      { get },
      { ...ENV, MOMO_SANDBOX_CURRENCY: 'EUR', MOMO_SANDBOX_AS_CURRENCY: 'GHS' },
    );
    await expect(provider.verifyPayment(input.reference)).resolves.toMatchObject({
      currency: 'EUR',
    });
  });
});

describe('MomoProvider webhooks and refunds', () => {
  it('accepts an unsigned callback only as a reference to re-verify', () => {
    const { provider } = makeProvider({});
    const body = Buffer.from(JSON.stringify({ externalId: input.reference, status: 'SUCCESSFUL' }));
    expect(provider.parseWebhook(body, undefined)).toEqual({
      reference: input.reference,
      kind: 'charge',
    });
  });

  it('discards callbacks whose reference is not ours', () => {
    const { provider } = makeProvider({});
    expect(
      provider.parseWebhook(Buffer.from(JSON.stringify({ externalId: 'nope' })), undefined),
    ).toBeNull();
    expect(provider.parseWebhook(Buffer.from('not json'), undefined)).toBeNull();
    expect(provider.parseWebhook(Buffer.from(JSON.stringify({})), undefined)).toBeNull();
  });

  it('refuses refunds rather than pretending money moved', async () => {
    const { provider } = makeProvider({});
    await expect(provider.refundPayment({ reference: input.reference })).rejects.toThrow(
      /Disbursement/,
    );
  });
});
