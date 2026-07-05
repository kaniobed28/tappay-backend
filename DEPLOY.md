# Deploying TapPay backend (Render)

This gets the backend + PostgreSQL live at a permanent public URL so both phones work
anywhere over the internet — PC off. Everything is pre-wired in [`render.yaml`](render.yaml);
you only click through Render once and paste two Paystack keys.

## 1. Create the services (one-time, ~5 min)

1. Go to https://render.com and sign up (free; GitHub login is easiest).
2. **New +** → **Blueprint**.
3. Connect your GitHub and pick the **`tappay-backend`** repo.
4. Render reads `render.yaml` and shows a plan: a **web service** (`tappay-api`) + a
   **Postgres** (`tappay-db`). Click **Apply**.
5. It provisions the database, wires `DATABASE_URL`, generates `SESSION_SIGNING_SECRET`,
   runs the build, applies the migration, and boots. First deploy takes ~3–5 min.

## 2. Add your Paystack keys

In the `tappay-api` service → **Environment** → add:

| Key | Value |
|-----|-------|
| `PAYSTACK_SECRET_KEY` | your `sk_test_…` |
| `PAYSTACK_PUBLIC_KEY` | your `pk_test_…` |

Save → it redeploys. When it's live, note the URL, e.g. `https://tappay-api.onrender.com`.

Health check: open `https://<your-url>/api/health` — you should see `{"status":"ok",…}`.

## 3. Point the Paystack webhook at it (optional but recommended)

Paystack dashboard → Settings → API Keys & Webhooks → Webhook URL:
`https://<your-url>/api/webhooks/paystack`

## 4. Build the app for both phones

From the `mobile` repo, build a release APK baked with your URL:

```bash
flutter build apk --release \
  --dart-define=API_BASE_URL=https://<your-url>/api
```

The APK is at `build/app/outputs/flutter-apk/app-release.apk`. Send it to both phones
(email/Drive/USB) and install (enable "install from unknown sources"). No PC or cable
needed after that — sign in with any email/password and tap away.

## Notes & caveats

- **Auth is demo mode.** `ALLOW_DEV_AUTH=true` lets phones sign in without Firebase, but it's
  **insecure — anyone can impersonate any user.** Fine for a private demo; before anything
  real, wire Firebase Auth (add a service account to `FIREBASE_SERVICE_ACCOUNT_JSON`, drop
  `google-services.json` into the app) and set `ALLOW_DEV_AUTH=false`.
- **Free tier sleeps.** Render's free web service spins down after ~15 min idle; the first
  request then takes ~50s to wake. Free Postgres is time-limited — upgrade for anything lasting.
- **Migrations** run automatically on deploy (`prisma migrate deploy`). Schema changes = add a
  migration and push; Render redeploys and applies it.
