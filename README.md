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

## Paystack webhook

Point your Paystack dashboard webhook URL at `https://<host>/api/webhooks/paystack`.
The signature is verified with HMAC-SHA512 over the raw body, then the transaction is
reconciled against Paystack's verify endpoint — the payload status is never trusted directly.

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
| POST | `/api/webhooks/paystack` | public | provider confirmation |

## Swapping payment providers

Implement `PaymentProvider`
([`src/payments/provider/payment-provider.interface.ts`](src/payments/provider/payment-provider.interface.ts))
and change the `PAYMENT_PROVIDER` binding in
[`src/payments/payments.module.ts`](src/payments/payments.module.ts). Nothing else changes.
