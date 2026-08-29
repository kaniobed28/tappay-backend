# Deploying TapPay backend (Render + Neon)

This gets the backend + PostgreSQL live at a permanent public URL so both phones work
anywhere over the internet — PC off.

**The app runs on Render; the database runs on [Neon](https://neon.tech).** Render's free
Postgres expires 30 days after creation and is then deleted, which is no good for a
long-running demo. Neon's free tier has no expiry (0.5 GB storage, one always-available
compute), and Prisma talks to it over a plain connection string — nothing else changes.

## 1. Create the database (one-time, ~3 min)

1. Sign up at https://neon.tech (free; GitHub login is easiest).
2. **New Project** → name it `tappay`, region **AWS eu-central-1 (Frankfurt)** to sit next
   to the Render service. Postgres 16.
3. On the project dashboard, open **Connect** and copy **two** connection strings:
   - **Pooled** (the default — host contains `-pooler`) → this is `DATABASE_URL`.
     Append `&pgbouncer=true` so Prisma knows it's behind PgBouncer.
   - **Direct** (toggle *Connection pooling* **off** — host has no `-pooler`) → this is
     `DIRECT_URL`. Migrations need it: PgBouncer's transaction mode can't hold the
     advisory locks `prisma migrate` takes.

   They look like:
   ```
   DATABASE_URL=postgresql://tappay_owner:PASS@ep-cool-boat-123-pooler.eu-central-1.aws.neon.tech/tappay?sslmode=require&pgbouncer=true
   DIRECT_URL=postgresql://tappay_owner:PASS@ep-cool-boat-123.eu-central-1.aws.neon.tech/tappay?sslmode=require
   ```

## 2. Create the web service (one-time, ~5 min)

1. Go to https://render.com and sign up (free; GitHub login is easiest).
2. **New +** → **Blueprint**.
3. Connect your GitHub and pick the **`tappay-backend`** repo.
4. Render reads [`render.yaml`](render.yaml) and shows a plan: one **web service**
   (`tappay-api`). Click **Apply**. It will fail its first boot — the DB env vars aren't
   set yet. That's expected; step 3 fixes it.

## 3. Add your env vars

In the `tappay-api` service → **Environment** → add:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | the **pooled** Neon string from step 1 |
| `DIRECT_URL` | the **direct** Neon string from step 1 |
| `PAYSTACK_SECRET_KEY` | your `sk_test_…` |
| `PAYSTACK_PUBLIC_KEY` | your `pk_test_…` |

Save → it redeploys. The start command runs `prisma migrate deploy`, which creates the
schema in the empty Neon database on that first successful boot. When it's live, note the
URL, e.g. `https://tappay-api.onrender.com`.

Health check: open `https://<your-url>/api/health` — you should see `{"status":"ok",…}`.

## 4. Point the Paystack webhook at it (optional but recommended)

Paystack dashboard → Settings → API Keys & Webhooks → Webhook URL:
`https://<your-url>/api/webhooks/paystack`

## 5. Build the app for both phones

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
  request then takes ~50s to wake. The [`keep-warm`](.github/workflows/keep-warm.yml) workflow
  pings `/api/health` every 10 min to beat this — which also keeps Neon's compute from
  scaling to zero. That's within Neon's free allowance (a 0.25 CU compute running 24/7 is
  ~183 of the 191.9 compute-hours/month the free plan includes), but it leaves little
  headroom: if you add a second Neon compute or branch, watch the usage page.
- **Migrations** run automatically on deploy (`prisma migrate deploy`, over `DIRECT_URL`).
  Schema changes = add a migration and push; Render redeploys and applies it.
- **Never point `DATABASE_URL` at the direct (non-pooled) Neon host** for the running app.
  It works, but you lose PgBouncer's reconnect handling when Neon suspends an idle compute,
  and a query can then fail with a closed-connection error instead of transparently waking it.

## Appendix: moving data off the old Render database

Only needed if the Render `tappay-db` still holds data you care about — and it must be done
**before 2026-08-04**, when Render suspends it. A fresh Neon DB needs none of this; step 3
builds the schema from the migrations.

```bash
# 1. Dump from Render (grab the External Database URL from the Render dashboard).
pg_dump --no-owner --no-acl --format=custom \
  "postgresql://…@…frankfurt-postgres.render.com/tappay" -f tappay.dump

# 2. Create the schema on Neon, then load the rows into it.
DATABASE_URL="<neon-pooled>" DIRECT_URL="<neon-direct>" npx prisma migrate deploy
pg_restore --no-owner --no-acl --data-only --disable-triggers \
  -d "<neon-direct>" tappay.dump
```

Use the **direct** URL for both — `pg_dump`/`pg_restore` are session-oriented and don't play
well with PgBouncer. Sanity-check with `npx prisma studio` before deleting anything on Render.

## Triggering deploys

Ideally, enable **Settings → Build & Deploy → Auto-Deploy = Yes** so every push to `main`
deploys automatically.

If auto-deploy is off (or you want to deploy on demand), use a **Deploy Hook**:

1. Render dashboard → `tappay-api` → **Settings → Deploy Hook** → copy the URL.
2. Save it locally (gitignored) so the helper script can use it:
   ```bash
   echo 'https://api.render.com/deploy/srv-...?key=...' > scripts/.render-deploy-hook
   ```
3. Deploy any time with:
   ```bash
   ./scripts/render-deploy.sh
   ```
   It POSTs the hook and waits until `/api/health` is back to `200`.
