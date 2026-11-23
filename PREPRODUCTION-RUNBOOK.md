# CreditFlow pre-production deployment runbook

This runbook describes a staged deployment. Do not point a live merchant store at this environment until all release gates are signed off.

## 1. Managed services

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
| `SCOPES` | `read_orders,read_customers,read_products,write_store_credit_account_transactions` |
| `DATABASE_URL` | Private production PostgreSQL connection string |
| `SHADOW_DATABASE_URL` | Separate shadow database connection string for Prisma schema tooling |
| `CREDITFLOW_WORKER_SECRET` | Unique cryptographically random secret, at least 32 characters |

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

## 6. Release sequence

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

## 9. Launch model

The current launch direction is a free core app. Do not add a billing gate to the initial release. Optional Pikmora services and qualified merchant referrals are separate channels and must not change the source-of-truth or money-moving rules inside CreditFlow.
