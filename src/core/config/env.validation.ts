/**
 * Boot-time environment validation. A payments service must never start in a
 * half-configured state — this fails loudly instead of silently misbehaving later.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const isProd = config.NODE_ENV === 'production';
  const errors: string[] = [];

  const required = (key: string) => {
    if (!config[key] || String(config[key]).trim() === '') {
      errors.push(`${key} is required`);
    }
  };

  required('DATABASE_URL');
  required('SESSION_SIGNING_SECRET');

  // Session signing must be a real secret, never the shipped placeholder.
  const secret = String(config.SESSION_SIGNING_SECRET ?? '');
  if (secret === 'change-me-to-a-long-random-string' || (secret.length > 0 && secret.length < 16)) {
    errors.push('SESSION_SIGNING_SECRET must be set to a strong value (>= 16 chars)');
  }

  if (isProd) {
    // In production Firebase credentials are mandatory — UNLESS ALLOW_DEV_AUTH=true is
    // explicitly set (a documented, insecure escape hatch for demos before Firebase is
    // wired up). Default stays secure: no flag => Firebase required.
    const allowDevAuth = String(config.ALLOW_DEV_AUTH) === 'true';
    const hasFirebase =
      !!config.FIREBASE_SERVICE_ACCOUNT_BASE64 ||
      !!config.FIREBASE_SERVICE_ACCOUNT_JSON ||
      !!config.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (!hasFirebase && !allowDevAuth) {
      errors.push(
        'In production set FIREBASE_SERVICE_ACCOUNT_JSON/PATH, or ALLOW_DEV_AUTH=true for an (insecure) demo',
      );
    }
    // The active payment provider must have credentials.
    const provider = String(config.PAYMENT_PROVIDER ?? 'momo').trim().toLowerCase();
    if (provider === 'paystack' && !config.PAYSTACK_SECRET_KEY) {
      errors.push('PAYSTACK_SECRET_KEY is required when PAYMENT_PROVIDER=paystack');
    }
    if (provider === 'momo') {
      // MTN mints an access token from the API user/key pair, and every call also carries
      // the subscription key — a missing one fails only at the first real payment.
      for (const key of ['MOMO_SUBSCRIPTION_KEY', 'MOMO_API_USER', 'MOMO_API_KEY']) {
        if (!config[key]) errors.push(`${key} is required when PAYMENT_PROVIDER=momo`);
      }
      // 'sandbox' is MTN's test wallet platform; it cannot settle real money.
      if (String(config.MOMO_TARGET_ENVIRONMENT ?? 'mtnghana') === 'sandbox') {
        errors.push('MOMO_TARGET_ENVIRONMENT=sandbox cannot be used in production');
      }
    }
  }

  if (errors.length) {
    throw new Error(`Invalid environment configuration:\n  - ${errors.join('\n  - ')}`);
  }
  return config;
}
