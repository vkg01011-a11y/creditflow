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

Optional customer email delivery variables:

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend transactional email API key |
| `CREDITFLOW_EMAIL_FROM` | Sender address on a domain verified with Resend |

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

The embedded **Operations** page shows queue state, worker-secret configuration, and the latest authenticated worker heartbeat. A heartbeat becomes stale after three minutes without a new run; heartbeat history is retained for 14 days. Also monitor scheduler execution history in the hosting provider.

## Customer email notifications

Open **Customer emails** in the embedded app at `/app/notifications`.

Credit-issued notifications have three mutually exclusive modes:

- **Shopify native email** (default): CreditFlow passes Shopify's `notify: true` flag when issuing the Store Credit. Shopify sends its standard store-credit notification. Edit that message in Shopify Admin → Settings → Notifications.
- **CreditFlow branded email**: Shopify's native email is disabled for that credit grant and CreditFlow queues one custom transactional email through Resend. Merchants can configure sender display name, reply-to, logo, accent colour, subject, headline, message, CTA label, and footer.
- **Disabled**: the credit is still issued, but no issue email is sent.

Expiry reminders are a separate opt-in. Merchants choose reminders 7, 3, and/or 1 day before the expiry date. CreditFlow fetches the exact Shopify credit transaction immediately before sending and suppresses the reminder if the transaction has no expiry or its remaining amount is zero. The Operations page tracks queued, sent, skipped, and failed email notifications.

Before enabling CreditFlow-branded delivery or expiry reminders:

1. Create a Resend account and verify a sending domain by adding the DNS records Resend provides.
2. Set `RESEND_API_KEY` in the private hosting secret manager.
3. Set `CREDITFLOW_EMAIL_FROM` to a sender address on that verified domain, for example `CreditFlow Rewards <rewards@your-domain.com>`.
4. Confirm the app has `read_store_credit_accounts` and `read_store_credit_account_transactions` scopes. Stores may need to reauthorize after the scope change.
5. Save the email design in **Customer emails** and enable the required mode.

Template tokens:

- Issued credit: `{{ shop_name }}`, `{{ customer_first_name }}`, `{{ credit_amount }}`.
- Expiry reminder: `{{ shop_name }}`, `{{ customer_first_name }}`, `{{ remaining_amount }}`, `{{ expiry_date }}`.

These are transactional store-credit notifications, not marketing subscriptions. CreditFlow does not send both Shopify's native issue email and its own branded issue email for the same grant.

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

The Render staging Blueprint is in [render.yaml](./render.yaml). Review the resources, region, service names, and branch before creating the Blueprint in Render. It is configured for the feature branch; creating the Blueprint provisions billable resources.

See [PRODUCT-READINESS.md](./PRODUCT-READINESS.md), [RELIABILITY-OPERATIONS.md](./RELIABILITY-OPERATIONS.md), and [PREPRODUCTION-RUNBOOK.md](./PREPRODUCTION-RUNBOOK.md) for the release checklist and operating procedures.


## Pricing and Shopify App Pricing

CreditFlow's current plans are Starter $0/month with 100 evaluated orders then $0.10 per additional order; Growth $9/month with 300 included then $0.10/order; Professional $19/month with 1,000 included then $0.10/order; and Business $49/month with unlimited orders and no overage. Growth, Professional, and Business have 14-day trials. Starter is free forever with no trial. Prices are USD/month.

Shopify Partner Dashboard must define the recurring item handles `starter_plan`, `growth_plan`, `professional_plan`, and `business_plan`. Configure the `orders_processed` meter as graduated pricing: Starter 1–100 orders at $0.00/order, then 101+ at $0.10/order; Growth 1–300 at $0.00, then 301+ at $0.10; Professional 1–1,000 at $0.00, then 1,001+ at $0.10. Do not configure a meter on Business. The three paid plans each have a 14-day trial. These Partner Dashboard values are not created by application code.

Set private environment values `SHOPIFY_PARTNER_ORG_ID`, `SHOPIFY_PARTNER_API_ACCESS_TOKEN` (Manage apps permission), `SHOPIFY_APP_GID`, `SHOPIFY_PARTNER_API_VERSION` (default `2026-10`), `SHOPIFY_APP_EVENTS_API_VERSION` (default `2026-10`), and `SHOPIFY_APP_HANDLE` (default `creditflow`). Existing `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` are used for App Events token exchange. Do not commit these secrets.

One usage unit is reserved once per distinct, fully fulfilled Shopify order that CreditFlow evaluates with customer and currency fields present, even when no reward rule matches or credit is issued. Duplicate webhook deliveries and retries do not add a unit. Refunds do not erase an evaluated order. Trial, Business, and no-active-plan orders are not sent as billable events. App Events payloads contain only the shop ID, timestamp, hashed idempotency key, meter handle, and quantity; no customer or order details. A successful HTTP 202 confirms event receipt, not final billing validation; inspect the Dev Dashboard App Billing Event logs.

Core rewards, Store Credit accuracy, refund safety, and privacy workflows remain available on Starter. CreditFlow-branded emails and expiry reminders require Professional or Business and are checked again at delivery time.


Plan selection return URL: configure each public plan's Shopify App Pricing welcome link to return to `/app/billing`. The app keeps this route accessible without a subscription so merchants can select or change a plan; all other app routes redirect to Shopify's hosted pricing page once Partner API configuration is active.

Shopify trial policy note: each plan is configured with 14 trial days, but Shopify pools trial days across all plans for the same app/store over a rolling 180-day period. Switching from Growth to Professional does not restart a fresh 14-day trial; remaining trial is reduced by days already used.
