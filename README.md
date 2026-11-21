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

New automation rules are created paused. Review a rule before enabling it.

## Tech stack

- Shopify app framework: Shopify React Router
- Runtime: Node.js 22.12+
- Language: TypeScript and JavaScript modules
- Database: PostgreSQL
- ORM: Prisma 6
- Tests: Node.js built-in test runner

## Local development (Windows PowerShell)

Install dependencies:

```powershell
npm.cmd ci
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
| `SCOPES` | Comma-separated Shopify API scopes |
| `DATABASE_URL` | PostgreSQL connection string |
| `SHADOW_DATABASE_URL` | Prisma shadow database connection |
| `CREDITFLOW_WORKER_SECRET` | Random secret of at least 32 characters for the internal worker |

Optional runtime configuration includes `SHOPIFY_APP_URL` and `SHOP_CUSTOM_DOMAIN`.

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

## Background worker

Shopify webhooks persist minimized events and return quickly. Queue processing is performed by the protected `POST /internal/webhook-worker` endpoint.

The app does **not** create a background scheduler. Configure a trusted scheduler in the hosting environment to call this endpoint every minute with:

```http
Authorization: Bearer YOUR_CREDITFLOW_WORKER_SECRET
```

Optional batch size: `/internal/webhook-worker?limit=5`. The application clamps each queue's batch size to 1–10.

The embedded **Operations** page shows queue state and whether the worker secret is configured. Scheduler connectivity must be checked in the external scheduler itself.

## Refund safety

- Cashback reversal is calculated against the reward basis recorded when the grant was issued.
- Each refund/grant pair has a unique reservation before the Shopify debit mutation is called.
- Shopify remains the wallet authority.
- If a debit outcome is ambiguous, the app does not automatically repeat it. Inspect the customer’s Shopify Store Credit transactions and reconcile the corresponding entry in **Refund reversals**.
- Grants created before the reward-basis field was introduced require manual review for refunds.

## Deployment status

This repository is still in development. Before a production release:

- Configure real hosting URLs and OAuth redirect URLs in Shopify app configuration.
- Configure production PostgreSQL, backups, monitoring, secrets, and a trusted scheduler.
- Deploy webhook subscriptions only after end-to-end development-store testing.
- Complete Shopify billing/subscription enforcement and decide plans/pricing.
- Complete support, privacy, terms, and App Store listing requirements.
- Review and test all money-moving and privacy workflows on a development store.

See [PRODUCT-READINESS.md](./PRODUCT-READINESS.md) and [RELIABILITY-OPERATIONS.md](./RELIABILITY-OPERATIONS.md) for the release checklist and operational procedures.
