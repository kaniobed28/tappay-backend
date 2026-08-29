import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { PaymentsService } from '../src/payments/payments.service';
import { SessionService } from '../src/sessions/session.service';
import { PAYMENT_PROVIDER, PaymentProvider, ProviderModule } from '../src/payments/provider';

/**
 * Compiles the whole DI graph (without connecting to anything) so a broken module
 * wire fails here rather than at boot in production.
 */
describe('application wiring', () => {
  const env = { ...process.env };

  beforeAll(() => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/tappay';
    process.env.SESSION_SIGNING_SECRET = 'test-secret-that-is-long-enough';
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    process.env = env;
  });

  const compile = () =>
    Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

  it('resolves every feature module', async () => {
    const moduleRef = await compile();
    expect(moduleRef.get(PaymentsService, { strict: false })).toBeDefined();
    expect(moduleRef.get(SessionService, { strict: false })).toBeDefined();
    await moduleRef.close();
  });

  it('binds whichever payment provider this environment configures', async () => {
    const moduleRef = await compile();
    // Asserting a specific provider here would assert the developer's own .env; the
    // registry's defaulting and switching are pinned hermetically below.
    const configured = (
      moduleRef.get(ConfigService, { strict: false }).get<string>('PAYMENT_PROVIDER') ?? 'paystack'
    )
      .trim()
      .toLowerCase();
    const provider = moduleRef.get<PaymentProvider>(PAYMENT_PROVIDER, { strict: false });
    expect(provider.name).toBe(configured);
    await moduleRef.close();
  });
});

/**
 * The provider registry in isolation — configured explicitly rather than through the
 * developer's own .env, so the result doesn't depend on whose machine it runs on.
 */
describe('payment provider registry', () => {
  // A stubbed ConfigService rather than a real one: `.env` is loaded into process.env by
  // any earlier AppModule compile, and ConfigService falls back to it, so anything less
  // than a stub would make these tests depend on the developer's own configuration.
  const withProvider = (name?: string) =>
    Test.createTestingModule({ imports: [ProviderModule] })
      .overrideProvider(ConfigService)
      .useValue({ get: (key: string) => (key === 'PAYMENT_PROVIDER' ? name : undefined) })
      .compile();

  it('defaults to Paystack when nothing is configured', async () => {
    const moduleRef = await withProvider();
    expect(moduleRef.get<PaymentProvider>(PAYMENT_PROVIDER).name).toBe('paystack');
    await moduleRef.close();
  });

  it('switches to MTN MoMo on PAYMENT_PROVIDER alone — no code change', async () => {
    const moduleRef = await withProvider('momo');
    expect(moduleRef.get<PaymentProvider>(PAYMENT_PROVIDER).name).toBe('momo');
    await moduleRef.close();
  });

  it('is case- and whitespace-insensitive, as env vars are hand-edited', async () => {
    const moduleRef = await withProvider('  MoMo ');
    expect(moduleRef.get<PaymentProvider>(PAYMENT_PROVIDER).name).toBe('momo');
    await moduleRef.close();
  });

  it('refuses to start on an unknown provider rather than silently defaulting', async () => {
    await expect(withProvider('mpesa')).rejects.toThrow(/Unknown PAYMENT_PROVIDER/);
  });
});
