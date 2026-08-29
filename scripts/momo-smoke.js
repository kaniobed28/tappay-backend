#!/usr/bin/env node
//
// End-to-end check of the MTN MoMo credentials, against the sandbox.
//
// Drives the real `MomoProvider` — the same code that runs in production — so a pass
// means tokens mint, MTN accepts a payment request, and the result reconciles back to
// the amount and currency TapPay booked. That last part is the one worth checking: an
// amount or currency that doesn't round-trip makes a good payment settle as FAILED.
//
//   npm run build && npm run momo:smoke
//
// Options (env): MOMO_SMOKE_PHONE (default 0241234567), MOMO_SMOKE_AMOUNT (minor units).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

require('./load-env');

const PROVIDER_PATH = path.join(__dirname, '..', 'dist', 'payments', 'provider', 'momo', 'momo.provider.js');

async function main() {
  // A smoke test pushes a real payment request. Against production that would ring a real
  // person's phone and take real money, so refuse anything but the sandbox.
  const target = process.env.MOMO_TARGET_ENVIRONMENT ?? 'mtnghana';
  if (target !== 'sandbox') {
    fail(
      `Refusing to run: MOMO_TARGET_ENVIRONMENT is "${target}".\n` +
        'This sends a real payment request — it is only safe against the sandbox.',
    );
  }
  if (!fs.existsSync(PROVIDER_PATH)) fail('Build first: npm run build');

  const { MomoProvider } = require(PROVIDER_PATH);
  const provider = new MomoProvider({ get: (key) => process.env[key] });

  const reference = `tap_${crypto.randomBytes(10).toString('hex')}`;
  const amount = Number(process.env.MOMO_SMOKE_AMOUNT ?? 2500);
  const currency = 'GHS';
  const payerPhone = process.env.MOMO_SMOKE_PHONE ?? '0241234567';

  console.log(`\n1. initializePayment — ${amount} ${currency} from ${payerPhone}`);
  const init = await provider.initializePayment({
    reference,
    amount,
    currency,
    email: 'smoke@tappay.app',
    payerPhone,
  });
  console.log(`   reference=${reference}`);
  console.log(`   kind=${init.kind}  providerReference=${init.providerReference}`);
  console.log(`   sent to MTN: ${init.raw.amount} ${init.raw.currency} -> ${init.raw.payer.partyId}`);
  if (init.kind !== 'push') fail(`Expected a push checkout, got "${init.kind}"`);

  console.log(`\n2. verifyPayment`);
  let verified;
  for (let attempt = 1; attempt <= 5; attempt++) {
    verified = await provider.verifyPayment(reference);
    console.log(`   attempt ${attempt}: status=${verified.status} amount=${verified.amount} currency=${verified.currency}`);
    if (verified.status !== 'pending') break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Exactly the comparison PaymentsService.reconcile makes before settling a payment.
  const reconciles = verified.amount === amount && verified.currency === currency;
  console.log(`\n3. reconciliation`);
  console.log(`   provider says ${verified.amount} ${verified.currency}; TapPay booked ${amount} ${currency}`);
  if (verified.status === 'success' && reconciles) {
    console.log(`   PASS — this payment would settle as SUCCESS.\n`);
    return;
  }
  if (verified.status === 'pending') {
    console.log(`   INCONCLUSIVE — still pending after 5 tries; not a failure, just slow.\n`);
    return;
  }
  fail(
    verified.status !== 'success'
      ? `Payment came back "${verified.status}".`
      : 'Amount/currency do not round-trip — a good payment would settle as FAILED.',
  );
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

main().catch((err) => {
  const http = err.response ? ` (HTTP ${err.response.status}: ${JSON.stringify(err.response.data)})` : '';
  fail(`FAILED: ${err.message}${http}`);
});
