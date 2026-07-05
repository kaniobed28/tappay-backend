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
    // No dev-auth bypass in production: Firebase credentials are mandatory.
    const hasFirebase =
      !!config.FIREBASE_SERVICE_ACCOUNT_JSON || !!config.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (!hasFirebase) {
      errors.push(
        'In production you must set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH',
      );
    }
    // The active payment provider must have credentials.
    const provider = String(config.PAYMENT_PROVIDER ?? 'paystack');
    if (provider === 'paystack' && !config.PAYSTACK_SECRET_KEY) {
      errors.push('PAYSTACK_SECRET_KEY is required when PAYMENT_PROVIDER=paystack');
    }
  }

  if (errors.length) {
    throw new Error(`Invalid environment configuration:\n  - ${errors.join('\n  - ')}`);
  }
  return config;
}
