# TapPay Backend

NestJS + Prisma (PostgreSQL) + Firebase Admin + Paystack.

## Prerequisites

- Node 20+
- Docker (for local Postgres) or a PostgreSQL instance
- A Firebase project (service account JSON) — optional in dev (see below)
- A Paystack account (test keys)

## Setup

```bash
cd backend
cp .env.example .env          # then fill in the values
npm install
docker compose up -d          # starts Postgres on :5432
npm run prisma:generate
npm run prisma:migrate        # creates tables (name it e.g. "init")
npm run start:dev
```

API is served at `http://localhost:3000/api`. Health check: `GET /api/health`.

## Authentication

Every route except `@Public()` ones requires `Authorization: Bearer <firebase-id-token>`.
The guard verifies the token with Firebase Admin and upserts a local user mirror.

**Dev without Firebase:** if no service account is configured and `NODE_ENV != production`,
the backend accepts tokens shaped like `dev:<uid>` (or `dev:<uid>:email@example.com`) so you
can exercise the API before wiring Firebase. Example:

```bash
curl http://localhost:3000/api/users/me -H "Authorization: Bearer dev:alice:alice@example.com"
```

## Firebase (production)

Download a service account key (Project Settings → Service accounts → Generate new private key),
save it as `backend/firebase-service-account.json`, and set `FIREBASE_SERVICE_ACCOUNT_PATH` in `.env`
(or paste the JSON into `FIREBASE_SERVICE_ACCOUNT_JSON`).

## Provider webhooks

Each provider posts to `https://<host>/api/webhooks/<provider name>` — `/api/webhooks/paystack`,
`/api/webhooks/momo`. Callbacks for a provider that isn't the active one are ignored.

Whatever arrives, the transaction is then reconciled against the provider's own status
endpoint: the payload's status is never trusted directly. Paystack's signature is verified
with HMAC-SHA512 over the raw body; MoMo callbacks are unsigned and sent exactly once, so
they count only as a hint to re-verify (see [MTN Mobile Money](#mtn-mobile-money-ghana)).

For local testing, expose your port with a tunnel (e.g. `ngrok http 3000`).

## Core endpoints

| Method | Path | Who | Purpose |
|--------|------|-----|---------|
| GET  | `/api/health` | public | liveness |
| GET  | `/api/users/me` | auth | current user |
| PATCH| `/api/users/me` | auth | update profile |
| POST | `/api/users/me/devices` | auth | register device / push token |
| POST | `/api/merchants` | auth | create/update merchant profile |
| GET  | `/api/merchants/me` | auth | my merchant profile |
| POST | `/api/sessions` | merchant | mint a signed NFC/QR session |
| GET  | `/api/sessions/:id` | auth | resolve a tapped/scanned session |
| POST | `/api/payments` | auth | confirm session → start checkout |
| GET  | `/api/payments/:id` | auth | poll a transaction (auto-reconciles) |
| GET  | `/api/payments` | auth | transaction history |
| POST | `/api/webhooks/:provider` | public | provider confirmation |

## Project layout

```
src/
  core/          infrastructure every feature may use: prisma, audit, config, common
  auth/ users/ merchants/ notifications/ realtime/   feature modules
  sessions/      signed tap/QR hand-off (no provider knowledge)
  payments/      settlement + reconciliation
    provider/    the swappable provider layer (see below)
  requests/ webhooks/ health/
```

`CoreModule` is global, so feature modules declare only their *feature* dependencies.
Modules talk to each other through exported services, never by reaching into another
module's folder.

## Swapping payment providers

Providers are selected at boot by the `PAYMENT_PROVIDER` env var — `paystack` (default)
or `momo`. Nothing outside [`src/payments/provider/`](src/payments/provider/) knows which
one is active, and an unknown name fails fast at startup rather than silently defaulting.

To add one: implement `PaymentProvider`
([`payment-provider.interface.ts`](src/payments/provider/payment-provider.interface.ts))
in its own folder, and add the class to `REGISTRY` in
[`provider.module.ts`](src/payments/provider/provider.module.ts). Its `name` becomes the
value of `PAYMENT_PROVIDER` that selects it, and the webhook path it is served on.

A provider completes a payment one of two ways, which the client handles generically:

| `checkout` | Means | Client behaviour |
|-----------|-------|------------------|
| `redirect` | hosted checkout page (card/bank) | opens `authorizationUrl` |
| `push` | approval prompt on the payer's phone (mobile money) | shows `instruction`, polls `GET /api/payments/:id` |

## MTN Mobile Money (Ghana)

```
PAYMENT_PROVIDER=momo
MOMO_SUBSCRIPTION_KEY=…      # Collection product subscription (momodeveloper.mtn.com)
MOMO_API_USER=…              # API user UUID
MOMO_API_KEY=…               # API key for that user
MOMO_TARGET_ENVIRONMENT=mtnghana   # 'sandbox' while testing
MOMO_BASE_URL=https://proxy.momoapi.mtn.com   # sandbox: https://sandbox.momodeveloper.mtn.com
```

The sandbox hands you only the subscription key; the API user and key are created over
the API, which this does for you:

```
MOMO_SUBSCRIPTION_KEY=<Collection primary key> npm run momo:sandbox
```

Worth knowing before going live:

- **It charges a phone, not a card.** The payer needs a mobile number on file; without one
  the API answers `400 {code: "payer_phone_required"}` and the app prompts for it.
- **No callback guarantees.** MTN delivers the callback once, unsigned, and only to the host
  registered as the API user's `providerCallbackHost`. Settlement therefore rides on polling —
  `GET /api/payments/:id` re-verifies with MTN on every read.
- **Refunds need a different product.** Collections cannot refund; that is the Disbursement
  API, with its own subscription and a funded account. `POST /payments/:id/refund` fails
  loudly rather than reporting money that never moved.
- **The sandbox settles in EUR only.** Set `MOMO_SANDBOX_CURRENCY=EUR` (plus
  `MOMO_SANDBOX_AS_CURRENCY=GHS`) to test GHS-priced sessions there; both are ignored
  outside `MOMO_TARGET_ENVIRONMENT=sandbox`, and production refuses to boot on `sandbox`.
