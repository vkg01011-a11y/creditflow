# CreditFlow pre-production deployment runbook

This runbook describes a staged deployment. Do not point a live merchant store at this environment until all release gates are signed off.

## 1. Managed services

The repository includes a Render Blueprint at `render.yaml`. It is pinned to `feature/reliability-webhook-queue` and defines the web service, PostgreSQL database, and one-minute cron runner. Review the service names, region, and plan before creating the Blueprint. Creating it provisions paid resources.

Create three managed resources:

1. **Web service** — deploy the repository's Dockerfile and expose port 3000.
2. **PostgreSQL** — use a managed PostgreSQL instance with private network access from the web and worker services.
3. **Cron/worker service** — run `npm run worker:once` every minute using the same application image.

Keep the database private. Do not expose PostgreSQL to the public internet when the provider supports private networking.

## 2. Web service configuration

Build from the repository root using `Dockerfile`.

- Build command: provider Docker build.
- Release/pre-deploy command: `npm run setup`.
- Start command: `npm run start`.
- Health check path: `/readyz`.
- Process liveness path: `/healthz`.
- Port: `3000`.

Run migrations once in the provider's release phase, not from every web replica's startup command.

## 3. Required environment variables

Set these values in the provider's secret environment manager:

| Variable | Configuration |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3000`, unless the platform injects its own port |
| `SHOPIFY_API_KEY` | Shopify app client ID |
| `SHOPIFY_API_SECRET` | Shopify app secret |
| `SHOPIFY_APP_URL` | Final public HTTPS app URL |
| `SCOPES` | `read_orders,read_customers,read_products,read_store_credit_accounts,read_store_credit_account_transactions,write_store_credit_account_transactions` |
| `DATABASE_URL` | Private production PostgreSQL connection string |
| `SHADOW_DATABASE_URL` | Separate shadow database connection string for Prisma schema tooling |
| `CREDITFLOW_WORKER_SECRET` | Unique cryptographically random secret, at least 32 characters |
| `RESEND_API_KEY` | Resend transactional email API key |
| `CREDITFLOW_EMAIL_FROM` | Sender display name and address on a verified Resend domain, e.g. `CreditFlow Rewards <rewards@your-domain.com>` |

Never commit production values to Git, print them in build logs, or place them in browser-visible code.

Generate a secret outside the app and paste it directly into the provider's secret manager. For example, on a trusted terminal with Node.js:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

## 4. Managed worker schedule

Create a cron job from the same Docker image:

- Command: `npm run worker:once`
- Schedule: every minute
- `WORKER_APP_URL`: same HTTPS app URL as the web service
- `CREDITFLOW_WORKER_SECRET`: exactly the same secret configured on the web service
- `WORKER_BATCH_LIMIT`: start at `5`

The runner sends one authenticated POST request, times out after 55 seconds, and prints structured queue counts. It never prints the bearer secret. Each authenticated invocation is also recorded in the platform-level WorkerRun heartbeat table; the embedded Operations page reports ONLINE, RUNNING, FAILED, STALE, or NOT_SEEN. Heartbeats older than 14 days are purged.

Do not treat a successful HTTP request as proof that all financial jobs were completed. Review the returned processed/retry/review/failed counts and the embedded Operations page. A `REVIEW_REQUIRED` financial operation is a safety stop and must be reconciled against Shopify's Store Credit transaction history.

## 5. Shopify app configuration

Before deploying the Shopify app configuration, edit `shopify.app.toml` and replace:

- `application_url` with the final public HTTPS URL.
- `auth.redirect_urls` with the exact OAuth callback URL under that domain.

Keep the configured API scopes aligned with the provider's `SCOPES` environment variable. Review the webhook subscription list, then deploy the configuration with:

```bash
npm run deploy
```

Do not deploy the current `https://example.com` placeholders to a production app configuration.

## 6. Customer email delivery

CreditFlow supports two mutually exclusive credit-issued email channels:

- Shopify native notification: the Store Credit mutation uses Shopify's `notify: true` flag. Merchants edit this template in Shopify Admin → Settings → Notifications.
- CreditFlow branded notification: the app uses `notify: false` for that grant and queues a designed transactional email through Resend. Merchants customize its logo, brand colour, sender display name, reply-to, subject, headline, body, CTA, and footer in `/app/notifications`.

The branded channel requires:

1. A Resend account and a sending domain verified by adding the DNS records Resend provides.
2. `RESEND_API_KEY` configured as a secret on the web service.
3. `CREDITFLOW_EMAIL_FROM` set to an address on the verified domain.
4. Shopify scopes `read_store_credit_accounts` and `read_store_credit_account_transactions` approved by the merchant after app reauthorization if required.

Expiry reminders are separately disabled by default. Merchants may select 7, 3, and/or 1 day before expiry. CreditFlow checks the exact Shopify credit transaction's `expiresAt` and `remainingAmount` immediately before sending. No reminder is sent if the credit has expired, has been fully spent, or Shopify no longer reports an expiry for that transaction.

The worker processes notification jobs through the same durable queue and exposes the result in **Operations**. Resend requests use a stable idempotency key to protect against duplicate sends when the worker retries an uncertain network request.

## 7. Release sequence

1. Provision PostgreSQL and configure a tested automated backup policy.
2. Configure all web-service environment variables and verify that secrets are not present in Git.
3. Deploy the web service with the release migration command.
4. Confirm `GET /healthz` returns HTTP 200.
5. Confirm `GET /readyz` returns HTTP 200 and both runtime configuration and database checks are `ok`.
6. Create and enable the one-minute worker schedule, then confirm the Operations page reports the worker heartbeat as ONLINE.
7. Confirm the cron execution history shows successful runs and inspect the Operations page for queue age and action-required records.
8. Deploy Shopify webhook subscriptions only after the real app URL and OAuth callback are configured.
9. Install the app on a dedicated development/staging Shopify store and complete the remaining release test matrix.
10. Keep production onboarding closed until privacy, support, monitoring, and rollback gates are complete.

## 7. Backup, restore, and rollback

- Use managed PostgreSQL automated backups or point-in-time recovery where available.
- Take an explicit backup before every schema migration.
- Periodically restore a backup into a separate database and verify application migration status against it.
- Keep migrations additive and forward-compatible. Do not roll back production by dropping columns or restoring an old schema over newer financial records.
- If application code must be rolled back, use a compatible prior image while retaining the forward-migrated database.
- Never manually delete a grant, reversal reservation, or debit ledger record to clear an operational warning.
- Investigate uncertain Store Credit mutations against Shopify's own customer transaction history before any manual correction.

## 8. Monitoring and incident response

At minimum, alert on:

- Web service unavailable or `/readyz` failing.
- Worker schedule missing, failing, or not running for more than a few minutes.
- Oldest unprocessed webhook/privacy request exceeding the operational target.
- Any webhook or privacy job in `FAILED` or `REVIEW_REQUIRED`.
- Database connection exhaustion, elevated query latency, and storage/backup failures.
- Store Credit issuance/debit errors and any uncertain financial mutation.

Keep customer personal data and access tokens out of application logs. Restrict access to database backups, privacy exports, and operational dashboards.

## 9. Shopify App Pricing setup

Create four monthly public plans in the Shopify Partner Dashboard. Recurring item handles must match exactly so the Partner API plan lookup can resolve them:

| Plan | Recurring handle | Monthly | Included orders | Meter |
|---|---|---:|---:|---|
| Starter | `starter_plan` | $0 | 100 | `orders_processed` at $0.10/order after allowance |
| Growth | `growth_plan` | $9 | 300 | `orders_processed` at $0.10/order after allowance |
| Professional | `professional_plan` | $19 | 1,000 | `orders_processed` at $0.10/order after allowance |
| Business | `business_plan` | $49 | Unlimited | No meter and no overage |

Set 14 free-trial days on Growth, Professional, and Business. Starter is free forever and has no trial. Shopify shares used trial days across the app's plans for a given store over a rolling 180-day period, so a plan switch does not restart a full 14-day trial. The meter handle is case-sensitive: `orders_processed`. Business must not include this meter. Set each plan's Shopify welcome link to `/app/billing`.

Add these as private hosting secrets/configuration: `SHOPIFY_PARTNER_ID` (the number in the Partner Dashboard URL, not the Dev Dashboard organization ID), `SHOPIFY_PARTNER_API_ACCESS_TOKEN` (Partner API client needs Manage apps permission), and `SHOPIFY_APP_GID`. Optional version overrides are `SHOPIFY_PARTNER_API_VERSION` and `SHOPIFY_APP_EVENTS_API_VERSION` (defaults `2026-10`); the staging Blueprint uses `SHOPIFY_APP_HANDLE=creditflow-1`, matching the installed app URL. Set the handle for the relevant app listing in other environments. The App Events API uses existing `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`. Never commit credentials.

Test only with a development store in the same Partner organization using no-charge plans. Verify each plan handle, trial duration, included meter allowance, and $0.10 event price. A 202 Accepted response confirms receipt only; inspect Dev Dashboard App Billing Event logs for asynchronous billing validation. Never use production stores for paid testing.

Usage is one distinct fully fulfilled order that CreditFlow evaluates after customer and currency validation, regardless of whether a reward is issued. Duplicate webhook deliveries and worker retries do not add usage. Refunds do not remove usage. Trial, Business, and shops without an active plan selection do not emit overage events.

Core rewards, Shopify-native Store Credit, refund safety, and privacy features remain available on Starter. Branded emails and expiry reminders require Professional or Business and the delivery worker rechecks entitlement.

## 10. Launch model

Shopify App Pricing manages subscription and usage billing; do not use the legacy Billing API or create charges directly from app code. Production billing stays inactive until Partner Dashboard plans and production secrets are configured, dev-store testing passes, and release gates are complete.

Billing plan-change safety: the worker snapshots the active billable plan when a fulfilled order is evaluated. It does not enqueue Business or trial orders. At delivery, the active plan must still match the snapshot; plan changes during a queued event route the item to manual review instead of risking a charge under the wrong allowance. A temporary Partner API failure must not delay Store Credit processing and results in no automatic usage event for that order.
