import { validateEnv } from '../src/core/config/env.validation';

const validDev = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  SESSION_SIGNING_SECRET: 'a-sufficiently-long-secret-value',
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
      NODE_ENV: 'production',
      PAYSTACK_SECRET_KEY: 'sk_live_x',
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
      NODE_ENV: 'production',
      FIREBASE_SERVICE_ACCOUNT_JSON: '{}',
      PAYSTACK_SECRET_KEY: 'sk_live_x',
    };
    expect(() => validateEnv(cfg)).not.toThrow();
  });
});
