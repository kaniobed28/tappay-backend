#!/usr/bin/env node
//
// Provisions an MTN MoMo *sandbox* API user + key, and writes them into backend/.env.
//
// The sandbox needs three credentials, but MTN only gives you one from the portal: the
// Collection subscription key. The other two (API user, API key) have to be created over
// the API, which is what this does.
//
// One-time setup:
//   1. Sign up at https://momodeveloper.mtn.com and subscribe to the *Collection* product.
//   2. Put the "Primary Key" from your profile into MOMO_SUBSCRIPTION_KEY in backend/.env.
//   3. npm run momo:sandbox
//
// The generated MOMO_API_USER / MOMO_API_KEY are written back into .env in place; nothing
// else in the file is touched. Pass --print to only print them instead.
//
// Sandbox only — production credentials come from MTN Ghana directly, under contract.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

require('./load-env');

const BASE = 'https://sandbox.momodeveloper.mtn.com';
const ENV_PATH = path.join(__dirname, '..', '.env');

async function main() {
  const subscriptionKey = (process.env.MOMO_SUBSCRIPTION_KEY ?? '').trim();
  if (!subscriptionKey || subscriptionKey.startsWith('REPLACE_')) {
    fail(
      'Set MOMO_SUBSCRIPTION_KEY in backend/.env to your Collection subscription (primary) key first.',
    );
  }

  // The callback host is registered with the user and is the ONLY host MTN will deliver
  // callbacks to. TapPay reconciles by polling, so a placeholder is fine in the sandbox.
  const callbackHost = process.env.MOMO_CALLBACK_HOST ?? 'example.com';
  const apiUser = crypto.randomUUID();

  const created = await fetch(`${BASE}/v1_0/apiuser`, {
    method: 'POST',
    headers: {
      'X-Reference-Id': apiUser,
      'Ocp-Apim-Subscription-Key': subscriptionKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ providerCallbackHost: callbackHost }),
  });
  if (created.status !== 201) {
    fail(`Creating the API user failed (${created.status}): ${await created.text()}`);
  }

  const keyed = await fetch(`${BASE}/v1_0/apiuser/${apiUser}/apikey`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': subscriptionKey },
  });
  if (keyed.status !== 201) {
    fail(`Creating the API key failed (${keyed.status}): ${await keyed.text()}`);
  }
  const { apiKey } = await keyed.json();

  const credentials = { MOMO_API_USER: apiUser, MOMO_API_KEY: apiKey };
  const written = process.argv.includes('--print') ? false : writeEnv(credentials);

  console.log(`\nSandbox API user created (callback host: ${callbackHost}).`);
  if (written) {
    console.log(`Written into ${ENV_PATH}:\n`);
  } else {
    console.log(`Add these to backend/.env:\n`);
  }
  for (const [key, value] of Object.entries(credentials)) console.log(`${key}=${value}`);
  console.log(`
Restart the backend. It should log:
  [ProviderModule] Payment provider: momo

Then pay in the app with any Ghanaian-shaped number (e.g. 0241234567). The sandbox
defaults to a successful payment; MTN's documented test numbers trigger specific
failures instead — https://momodeveloper.mtn.com/api-documentation/testing
`);
}

/**
 * Replaces the value of each key in .env, in place. Only those lines change: everything
 * else — other secrets, comments, ordering — is preserved byte for byte.
 * Returns false if there is no .env to write to.
 */
function writeEnv(values) {
  if (!fs.existsSync(ENV_PATH)) return false;
  let contents = fs.readFileSync(ENV_PATH, 'utf8');
  for (const [key, value] of Object.entries(values)) {
    const line = new RegExp(`^${key}=.*$`, 'm');
    contents = line.test(contents)
      ? contents.replace(line, `${key}=${value}`)
      : `${contents.replace(/\s*$/, '')}\n${key}=${value}\n`;
  }
  fs.writeFileSync(ENV_PATH, contents);
  return true;
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

main().catch((err) => fail(err.stack ?? String(err)));
