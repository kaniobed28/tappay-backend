import axios from 'axios';
import { PaystackProvider } from '../src/payments/provider/paystack.provider';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * Paystack validates the payer email and rejects addresses like "x@foo.try" with a 400
 * ("Invalid Email Address Passed"). Since we reconcile by reference and issue our own
 * receipt, a bad email must not hard-fail the payment: the provider retries once with a
 * valid synthetic address tied to the reference. Non-email errors must still propagate.
 */
function makeProvider(post: jest.Mock): PaystackProvider {
  mockedAxios.create.mockReturnValue({ post } as any);
  const config = {
    get: (k: string) =>
      k === 'PAYSTACK_SECRET_KEY'
        ? 'sk_test_x'
        : k === 'PAYSTACK_BASE_URL'
          ? 'https://api.paystack.co'
          : undefined,
  };
  return new PaystackProvider(config as any);
}

const invalidEmailError = {
  isAxiosError: true,
  response: { status: 400, data: { message: 'Invalid Email Address Passed' } },
};

const okResponse = (url: string) => ({
  data: { status: true, data: { authorization_url: url, reference: 'tap_1' } },
});

const input = { reference: 'tap_1', amount: 2500, currency: 'GHS', email: 'x@foo.try' } as any;

describe('PaystackProvider email fallback', () => {
  beforeEach(() => {
    (mockedAxios.isAxiosError as unknown as jest.Mock).mockImplementation(
      (e: any) => !!e?.isAxiosError,
    );
  });

  it('retries with a synthetic email when the provider rejects the payer email', async () => {
    const post = jest
      .fn()
      .mockRejectedValueOnce(invalidEmailError)
      .mockResolvedValueOnce(okResponse('https://checkout.paystack.com/x'));
    const provider = makeProvider(post);

    const res = await provider.initializePayment(input);

    expect(res.authorizationUrl).toBe('https://checkout.paystack.com/x');
    expect(post).toHaveBeenCalledTimes(2);
    const secondBody = post.mock.calls[1][1];
    expect(secondBody.email).toBe('payer-tap_1@tappay-user.com');
    expect(secondBody.email).not.toBe('x@foo.try');
  });

  it('does NOT retry on a non-email error and propagates it', async () => {
    const post = jest.fn().mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 500, data: { message: 'server error' } },
    });
    const provider = makeProvider(post);

    await expect(provider.initializePayment(input)).rejects.toBeDefined();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the first call succeeds with a valid email', async () => {
    const post = jest.fn().mockResolvedValueOnce(okResponse('https://checkout.paystack.com/ok'));
    const provider = makeProvider(post);

    const res = await provider.initializePayment({ ...input, email: 'good@gmail.com' });

    expect(res.authorizationUrl).toBe('https://checkout.paystack.com/ok');
    expect(post).toHaveBeenCalledTimes(1);
  });
});
