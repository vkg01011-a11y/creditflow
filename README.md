# CreditFlow

CreditFlow is an embedded Shopify app for rule-based cashback rewards using **Shopify's native Store Credit**.

## Product principle

Shopify is the authoritative source for customer Store Credit balances and transactions. CreditFlow stores reward rules, grant/reversal metadata, idempotency keys, webhook inbox records, audit information, and reporting data. It is not a second wallet.

## Current capabilities

- Configure cashback rules triggered by fully fulfilled orders.
- Calculate percentage or fixed rewards with minimums, caps, expiry, prepaid requirements, product eligibility, and AND/OR conditions.
- Issue Shopify native Store Credit using Shopify Admin GraphQL.
- Store grant and transaction metadata in PostgreSQL.
- Process fulfillment and refund webhooks through a durable database-backed queue.
- Proportionally reverse cashback after partial/full refunds, with duplicate protection and manual review for uncertain outcomes.
- Inspect refund reversals and operational webhook/privacy queues inside the embedded app.
- Process Shopify customer data requests and customer/shop redaction webhooks.
- Expose public liveness and dependency readiness probes.
- Run the protected worker from a managed cron/scheduler using a one-shot Node.js command.

New automation rules are created paused. Review a rule before enabling it.

## Tech stack

- Shopify app framework: Shopify React Router
- Runtime: Node.js 22.12+
- Language: TypeScript and JavaScript modules
- Database: PostgreSQL
- ORM: Prisma 6
- Tests: Node.js built-in test runner
- Deployment: Docker-compatible managed Node hosting

## Local development (Windows PowerShell)

Install dependencies:

```powershell
npm.cmd ci
Copy-Item .env.example .env
```

Link the Shopify app configuration and retrieve app environment values:

```powershell
npm.cmd run config:link
npm.cmd run shopify -- app env pull
```

Configure the local PostgreSQL connection and worker secret in `.env`. Keep this file private; it is Git-ignored.

Required environment variables:

| Variable | Purpose |
|---|---|
| `SHOPIFY_API_KEY` | Shopify app client ID |
| `SHOPIFY_API_SECRET` | Shopify app secret; also used for HMAC-based privacy pseudonyms |
| `SHOPIFY_APP_URL` | Public app URL used by Shopify authentication |
| `SCOPES` | Comma-separated Shopify API scopes required by the app |
| `DATABASE_URL` | PostgreSQL connection string |
| `SHADOW_DATABASE_URL` | Prisma shadow database connection |
| `CREDITFLOW_WORKER_SECRET` | Random secret of at least 32 characters for the internal worker |

Optional worker variables:

| Variable | Purpose |
|---|---|
| `WORKER_APP_URL` | Override the app URL used by the scheduled worker |
| `WORKER_BATCH_LIMIT` | Worker batch size from 1 to 10; defaults to 5 |

Generate Prisma Client and apply migrations to the local development database:

```powershell
npx.cmd prisma generate
npx.cmd prisma migrate deploy
```

Start the Shopify development preview:

```powershell
npm.cmd run dev -- --store creditflow-dev-vivek.myshopify.com
```

## Validation

Run the checks from the project root:

```powershell
npx.cmd prisma validate
npx.cmd prisma generate
npx.cmd prisma migrate status
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Back up PostgreSQL before applying any new migration to a database containing data.

## Health and readiness

- `GET /healthz` is a lightweight liveness probe. It confirms that the web process can answer requests.
- `GET /readyz` checks required runtime configuration and PostgreSQL connectivity. It returns HTTP 200 only when both are ready; otherwise it returns HTTP 503.
- Readiness responses never include credentials, database URLs, or raw connection errors.

Use `/readyz` for deployment health gates. A passing readiness response does not prove that Shopify has deployed the latest webhook subscriptions or that the external scheduler is running.

## Background worker

Shopify webhooks persist minimized events and return quickly. Queue processing is performed by the protected `POST /internal/webhook-worker` endpoint.

For a managed scheduler or cron job, configure these environment variables:

- `SHOPIFY_APP_URL` or `WORKER_APP_URL`: the public HTTPS app URL.
- `CREDITFLOW_WORKER_SECRET`: the same 32+ character secret configured on the web service.
- Optionally, `WORKER_BATCH_LIMIT`: 1–10.

Run one worker batch:

```bash
npm run worker:once
```

Schedule that command every minute in the hosting provider. The runner sends the protected POST request, enforces a 55-second timeout, and emits structured counts without logging the secret.

The embedded **Operations** page shows queue state and whether the worker secret is configured. Scheduler connectivity must still be monitored in the external scheduler.

## Container deployment

Build the production image:

```bash
docker build -t creditflow:preproduction .
```

Configure the production environment variables before deployment. Run Prisma migrations once as the provider's release/pre-deploy command:

```bash
npm run setup
```

Start the web service with the Docker image's default command, equivalent to:

```bash
npm run start
```

Do not run database migrations independently from every web replica at startup. Use one release step for each deployment.

The worker scheduler can use the same image with the command `npm run worker:once`. Do not expose `CREDITFLOW_WORKER_SECRET` to browser code or public logs.

## Refund safety

- Cashback reversal is calculated against the reward basis recorded when the grant was issued.
- Each refund/grant pair has a unique reservation before the Shopify debit mutation is called.
- Shopify remains the wallet authority.
- If a debit outcome is ambiguous, the app does not automatically repeat it. Inspect the customer’s Shopify Store Credit transactions and reconcile the corresponding entry in **Refund reversals**.
- Grants created before the reward-basis field was introduced require manual review for refunds.

## Production release gates

This repository is not yet approved for live merchants or the Shopify App Store. Before release:

- Replace placeholder Shopify app and OAuth URLs with the final HTTPS domain.
- Provision production PostgreSQL and test backup/restore.
- Configure secrets, monitoring, log retention, and a trusted one-minute worker schedule.
- Deploy and verify current webhook subscriptions.
- Complete install, reauthorization, uninstall/reinstall, privacy, and worker recovery testing.
- Publish a privacy policy, terms, support contact, support documentation, and App Store listing assets.
- Review Shopify policy compliance and data handling with appropriate legal advice.

See [PRODUCT-READINESS.md](./PRODUCT-READINESS.md), [RELIABILITY-OPERATIONS.md](./RELIABILITY-OPERATIONS.md), and [PREPRODUCTION-RUNBOOK.md](./PREPRODUCTION-RUNBOOK.md) for the release checklist and operating procedures.
