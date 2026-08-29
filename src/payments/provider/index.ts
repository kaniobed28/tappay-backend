/**
 * Public surface of the provider layer. Consumers (payments, webhooks) depend on the
 * interface and the DI token only — never on a concrete provider.
 */
export * from './payment-provider.interface';
export * from './provider.module';
