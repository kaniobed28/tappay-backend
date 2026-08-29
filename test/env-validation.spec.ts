import { validateEnv } from '../src/core/config/env.validation';

const validDev = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  SESSION_SIGNING_SECRET: 'a-sufficiently-long-secret-value',
};

/** What the default provider (MTN MoMo) needs before production will start. */
const momoCredentials = {
  MOMO_SUBSCRIPTION_KEY: 'sub_key',
  MOMO_API_USER: 'api-user-uuid',
  MOMO_API_KEY: 'api-key',
  MOMO_TARGET_ENVIRONMENT: 'mtnghana',
};

describe('validateEnv', () => {
  it('passes with a valid development config', () => {
    expect(() => validateEnv({ ...validDev })).not.toThrow();
  });

  it('throws when DATABASE_URL is missing', () => {
    const cfg = { ...validDev, DATABASE_URL: '' };
    expect(() => validateEnv(cfg)).toThrow(/DATABASE_URL is required/);
  });

  it('rejects the shipped placeholder signing secret', () => {
    const cfg = { ...validDev, SESSION_SIGNING_SECRET: 'change-me-to-a-long-random-string' };
    expect(() => validateEnv(cfg)).toThrow(/SESSION_SIGNING_SECRET/);
  });

  it('rejects a too-short signing secret', () => {
    const cfg = { ...validDev, SESSION_SIGNING_SECRET: 'short' };
    expect(() => validateEnv(cfg)).toThrow(/SESSION_SIGNING_SECRET/);
  });

  it('requires Firebase credentials in production (no dev-auth bypass by default)', () => {
    const cfg = { ...validDev, NODE_ENV: 'production', PAYSTACK_SECRET_KEY: 'sk_live_x' };
    expect(() => validateEnv(cfg)).toThrow(/FIREBASE_SERVICE_ACCOUNT/);
  });

  it('allows production without Firebase when ALLOW_DEV_AUTH=true (explicit demo opt-in)', () => {
    const cfg = {
      ...validDev,
      ...momoCredentials,
      NODE_ENV: 'production',
      ALLOW_DEV_AUTH: 'true',
    };
    expect(() => validateEnv(cfg)).not.toThrow();
  });

  it('requires the provider key in production', () => {
    const cfg = {
      ...validDev,
      NODE_ENV: 'production',
      FIREBASE_SERVICE_ACCOUNT_JSON: '{}',
      PAYMENT_PROVIDER: 'paystack',
    };
    expect(() => validateEnv(cfg)).toThrow(/PAYSTACK_SECRET_KEY is required/);
  });

  it('passes a complete production config', () => {
    const cfg = {
      ...validDev,
      ...momoCredentials,
      NODE_ENV: 'production',
      FIREBASE_SERVICE_ACCOUNT_JSON: '{}',
    };
    expect(() => validateEnv(cfg)).not.toThrow();
  });

  /**
   * MoMo is the default provider, so an otherwise-valid production config that never
   * mentions a provider must still be held to MoMo's requirements — otherwise the API
   * would boot and fail only at the first real payment.
   */
  it('requires the MoMo credentials in production even when no provider is named', () => {
    const cfg = { ...validDev, NODE_ENV: 'production', FIREBASE_SERVICE_ACCOUNT_JSON: '{}' };
    expect(() => validateEnv(cfg)).toThrow(/MOMO_SUBSCRIPTION_KEY is required/);
  });

  it('refuses the MoMo sandbox in production — it cannot settle real money', () => {
    const cfg = {
      ...validDev,
      ...momoCredentials,
      NODE_ENV: 'production',
      FIREBASE_SERVICE_ACCOUNT_JSON: '{}',
      MOMO_TARGET_ENVIRONMENT: 'sandbox',
    };
    expect(() => validateEnv(cfg)).toThrow(/sandbox cannot be used in production/);
  });

  it('still validates Paystack when it is the chosen provider', () => {
    const cfg = {
      ...validDev,
      NODE_ENV: 'production',
      FIREBASE_SERVICE_ACCOUNT_JSON: '{}',
      PAYMENT_PROVIDER: 'paystack',
      PAYSTACK_SECRET_KEY: 'sk_live_x',
    };
    expect(() => validateEnv(cfg)).not.toThrow();
  });
});
