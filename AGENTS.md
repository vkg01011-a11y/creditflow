# Pikmora Perks Repository Guide

## Purpose and safety rules

Pikmora Perks is a public, embedded Shopify app for cashback rewards. Shopify Native Store Credit is the only customer balance authority. Pikmora Perks persists rules, grant and reversal metadata, idempotency records, transaction references, operational queues, and reporting data; it must never maintain or expose a competing wallet balance.

Use the Shopify AI Toolkit for Shopify API, App Pricing, and platform work. Check current Shopify documentation and schemas before changing GraphQL operations, scopes, webhook configuration, pricing behavior, or Shopify CLI configuration. Do not add toolkit dependencies to this repository; install/use the toolkit in the agent host. See the [Shopify AI Toolkit](https://shopify.dev/docs/api/ai-toolkit).

Follow these project rules:

- Do not switch to `main`, merge a pull request, or deploy to production without explicit user approval.
- Do not expose or commit environment secrets. Keep credentials in the private host environment or a local ignored `.env`.
- Do not modify a production database or infrastructure without explicit approval.
- Keep financial operations idempotent. Never blindly retry an ambiguous Shopify Store Credit credit/debit mutation.
- Preserve Shopify Native Store Credit as the authoritative balance.
- Run relevant tests and type checks after application changes. Use a development Shopify store and non-production database for integration work.
- Explain meaningful architecture or financial-safety decisions in the change summary.

The expected working branch for this task is `feature/reliability-webhook-queue`. Preserve the active branch unless the user explicitly approves a switch.

## Stack and application shape

- Node.js 22.12+, TypeScript/JavaScript, React Router 7, Shopify's React Router app package, Prisma 6, and PostgreSQL.
- `app/routes.ts` enables flat file routes under `app/routes/`. `app/root.tsx` is the document shell; `app/routes/app.tsx` authenticates the embedded app and supplies navigation.
- `app/shopify.server.ts` configures Shopify Admin API version October 2026, OAuth/session storage, scopes, and merchant activation after authentication.
- `app/db.server.ts` provides the Prisma client. `prisma/schema.prisma` and ordered PostgreSQL migrations under `prisma/migrations/` are the authoritative application schema.
- Domain modules under `app/domain/` hold mostly pure calculations and normalization. Server integrations and workflows live under `app/services/`; route loaders/actions under `app/routes/` authenticate and connect UI/API requests to those services.
- `app/styles/creditflow-ui.css` contains shared styling. The app uses Shopify Polaris web components in its embedded pages.

Important areas:

- Rewards and order execution: `app/routes/app.automations.tsx`, `app/routes/api.automations.ts`, `app/services/fulfillment-reward.server.ts`, `app/domain/reward-engine.mjs`.
- Preview and history: `app/routes/app.automation-simulator.tsx`, `app/routes/api.automation-simulator.ts`, `app/domain/automation-simulator.mjs`, `app/routes/app.automation-history.tsx`.
- Shopify webhook intake: `app/routes/webhooks.*.tsx`, `app/domain/webhook-payload.mjs`, `app/domain/webhook-time.mjs`.
- Queue worker and scheduler client: `app/routes/internal.webhook-worker.ts`, `scripts/worker-once.mjs`.
- Refunds: `app/services/refund-reversal.server.ts`, `app/domain/refund-reversal.mjs`, `app/routes/app.reversals.tsx`.
- Privacy: `app/services/privacy.server.ts`, `app/routes/app.privacy-requests.tsx`, `app/routes/api.privacy-requests.ts`.
- Billing: `app/services/billing.server.ts`, `app/routes/app.billing.tsx`.
- Customer emails: `app/services/email-notifications.server.ts`, `app/domain/email-template.mjs`, `app/routes/app.notifications.tsx`.
- Operations and health: `app/routes/app.operations.tsx`, `app/domain/worker-health.mjs`, `app/domain/runtime-readiness.mjs`, `app/routes/healthz.ts`, `app/routes/readyz.ts`.

## Store Credit, rewards, and refunds

The fulfillment webhook route authenticates with Shopify, minimizes the payload, and inserts a unique `shop + webhookId` record before returning. It does not issue credit in the request handler. The worker loads the shop's offline Admin API context and calls Shopify's Store Credit GraphQL mutation. Shopify returns the Store Credit transaction and account IDs; Pikmora Perks saves those references with the grant and metadata ledger entry.

Rules support fulfilled-order triggers, percentage or fixed rewards, order-subtotal or eligible-item bases, product include/exclude targeting, minimums, caps, expiry, prepaid requirements, and AND/OR conditions. Rules run by ascending priority and the first matching rule awards credit; rewards do not stack. Reward arithmetic uses integer currency minor units via `BigInt`, including zero- and three-decimal currencies.

The `CreditGrant` unique event key, Shopify transaction references, and `CreditLedgerEntry` are audit metadata, not a local balance. Do not calculate a customer's spendable balance from these tables. Store Credit account credit/debit mutations operate on Shopify's native account; see the versioned [Store Credit credit](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/storeCreditAccountCredit) and [debit](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/storeCreditAccountDebit) references.

Refund webhooks are minimized and queued. Reversal reservations are unique per shop/refund/grant and committed before Shopify debit calls. Refunds are calculated proportionally against the reward basis saved with the grant/rule snapshot, with cumulative refunds and debits capped. Missing basis/data, insufficient credit, or uncertain external outcomes go to `REVIEW_REQUIRED`; do not automatically issue another debit. Older grants without a stored reward basis require review.

Automation execution snapshots are separate from live rules. Grant rule snapshots preserve refund calculation inputs after edits or permanent deletion; automation execution history intentionally has no rule foreign key so history survives deletion.

## Webhooks, queues, privacy, and worker

Webhook IDs are idempotent per shop. Fulfillment/refund webhook routes store minimized JSON; customer email, postal address, and unrelated payload fields are discarded. Shopify's original webhook trigger time is stored for billing-cycle attribution; receipt time is the fallback for older events.

The protected `POST /internal/webhook-worker` endpoint claims PostgreSQL jobs using `FOR UPDATE SKIP LOCKED`. It processes webhook, privacy, email-notification, and billing-usage queues. Claims use a 15-minute lease; worker runs are recorded in `WorkerRun`, appear in Operations, become stale after 3 minutes, and are retained for 14 days. Retry delays are exponential from 30 seconds up to 60 minutes, with a maximum of 8 attempts for retryable work. Financial uncertainty is surfaced for review rather than blindly replayed.

`scripts/worker-once.mjs` sends a bearer-authenticated HTTPS request, defaults to a batch value of 5 (clamped to 1–10), and times out after 55 seconds. Render schedules this command every minute. The worker endpoint checks a 32-character minimum secret and uses constant-time comparison. Keep the scheduler configured and monitor its provider-side execution logs; a heartbeat only proves the endpoint ran.

Shopify customer-data, customer-redaction, and shop-redaction webhooks are queued. Customer data exports are retained in a protected app endpoint for the merchant's privacy-response process. Customer redaction pseudonymizes customer/order identifiers with an HMAC derived from `SHOPIFY_API_SECRET`, removes customer notification data and matching webhook payloads, and clears prior exports. Shop redaction removes sessions and shop-owned records. Keep privacy exports and payload retention aligned with the documented privacy policy and retention schedule.

## Rules and simulator

`api.automations.ts` validates rule fields, condition groups, product IDs, and decimal values, and scopes every read/write by the authenticated shop. The Rewards UI omits an enabled flag on create, so normal UI-created rules start paused. The API currently accepts an explicit `enabled: true` on create; do not treat the paused default as a server-enforced safety boundary until that mismatch is addressed.

The simulator is a read-only preview: it evaluates saved active or paused rules against validated sample data without writing to Shopify or PostgreSQL. Archived rules cannot be simulated. Activity records evaluation outcomes and the configuration/results used.

## Billing and usage metering

Shopify App Pricing is the supported app-pricing model here. Recurring plans and meter tiers live in the Shopify Partner Dashboard, not in application code or `shopify.app.toml`. The code's plan table in `app/services/billing.server.ts` currently defines:

| Plan | Monthly price | Included orders | Overage | Trial |
|---|---:|---:|---:|---:|
| Starter | $0 | 100 | $0.10/order | None |
| Growth | $9 | 300 | $0.10/order | 14 days |
| Professional | $19 | 1,000 | $0.10/order | 14 days |
| Business | $49 | Unlimited | None | 14 days |

The Partner Dashboard plan handles must be `starter_plan`, `growth_plan`, `professional_plan`, and `business_plan`; the usage meter handle is case-sensitive `orders_processed`. Configure graduated tiers externally: 1–100 / 1–300 / 1–1,000 included units at $0, then $0.10 per additional order on Starter / Growth / Professional. Business must have no meter. Partner Dashboard configuration was not verifiable from this repository. Shopify App Pricing trial usage is shared across plans within a rolling 180-day window; see Shopify's [App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing) and [trial](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/offer-free-trials) documentation.

`billing.server.ts` reads `activeSubscription` from the Partner API, matches the configured plan handle, and caches status for 45 seconds unless force-refreshed. The current Partner API version and App Events API version default to `2026-10`. The app does not create charges through the legacy Admin Billing API. Starter/core Store Credit behavior remains available without billing credentials; Professional and Business entitle branded emails and expiry reminders.

A unique `BillingUsageEvent` is reserved once per qualifying distinct fulfilled order (customer and currency present) while a confirmed paid metered plan and valid billing cycle are active. It stores the plan at occurrence and Shopify's original event timestamp. Unknown plan/cycle/status is durably recorded as `REVIEW_REQUIRED`, and must not block rewards. Trial metadata comes from Shopify's `trialEndsAt`; a missing billing cycle is not evidence of a trial. Immediately before delivery, the worker revalidates the plan and half-open cycle interval. A plan/trial/cycle change moves the event to review; it is not silently skipped or auto-submitted. Transient App Events failures retry with the same stable idempotency key; uncertain/exhausted sends require checking Shopify Dev Dashboard → App Billing Events before manual action. App Events payloads contain no customer/order details. See [Create an App Event](https://shopify.dev/docs/api/app-events/2026-10/creating-events) and [Partner ActiveSubscription](https://shopify.dev/docs/api/partner/2026-10/objects/ActiveSubscription).

`getBillingStatus` caches per shop for 45 seconds and coalesces concurrent lookups. Partner API, token, and App Events fetches have bounded 10-second timeouts. Operations displays status counts and recent queued/review items without order or customer identifiers. The Plan & usage page retains the Shopify-hosted plan-management link even when status lookup fails; its warning explains that current totals are unavailable while Store Credit automation continues. HTTP acceptance is not proof Shopify finally billed an event.

Required private billing environment values are `SHOPIFY_PARTNER_ID` (numeric Partner ID), `SHOPIFY_PARTNER_API_ACCESS_TOKEN`, `SHOPIFY_APP_GID`, and existing `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`. Optional overrides are `SHOPIFY_PARTNER_API_VERSION`, `SHOPIFY_APP_EVENTS_API_VERSION`, and `SHOPIFY_APP_HANDLE` (defaults to `creditflow`). Do not put credentials in source. These Partner API variables are listed in `.env.example` but are not declared in the Render Blueprint, so configure them as private host variables when billing is intended to be active.

## Branded customer email

Credit-issued email modes are mutually exclusive: Shopify native (default), Pikmora Perks custom via Resend, or disabled. Custom credit-issued email suppresses Shopify's native notification and queues a single Resend delivery after the Shopify transaction and local metadata are saved. A stable Resend idempotency key protects retries. Expiry reminders are opt-in for 7, 3, and/or 1 day before expiry; immediately before delivery, Shopify's exact transaction expiry and remaining amount are checked. Custom emails/reminders require Professional or Business at save/delivery time. Provider secrets are `RESEND_API_KEY` and `CREDITFLOW_EMAIL_FROM`; merchant email designs are stored in `EmailNotificationSettings`.

## Deployment, configuration, and commands

`render.yaml` is a feature-branch **staging** Blueprint only: a Docker web service, PostgreSQL database, and one-minute cron worker in Singapore. It is not production infrastructure. `shopify.app.toml` also points to the staging URL and registers app lifecycle, fulfilled-order, refund, and required privacy webhooks. Review/replace staging URLs and verify the webhook configuration before any app-config deployment.

The Docker image uses Node 22, generates Prisma Client and builds the app. Render runs `npm run setup` as its one-off pre-deploy command (`prisma generate && prisma migrate deploy`); the web process starts with `npm run start`. Do not run migrations independently at every replica startup. The worker cron calls the authenticated web endpoint rather than opening a separate database client.

- `GET /healthz` is liveness only.
- `GET /readyz` checks required non-secret Shopify/runtime configuration and PostgreSQL connectivity; it does not prove webhooks are deployed or the scheduler is running.
- `.env.example` is the local template; `.gitignore` and `.dockerignore` exclude `.env*`. Never replace its placeholders with credentials in a commit.

Useful commands from the repository root:

```powershell
npm.cmd ci
npx.cmd prisma validate
npx.cmd prisma generate
npx.cmd prisma migrate deploy
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
docker build -t creditflow:preproduction .
npm.cmd run worker:once
```

The CI workflow is `.github/workflows/creditflow-validation.yml`. It validates the Render YAML and Prisma schema, applies migrations to clean PostgreSQL, runs the rule-deletion DB integration test and Node tests, typechecks, lints, builds, and builds the Docker image. The test suite uses Node's built-in runner. The rule-deletion integration test is skipped unless `CREDITFLOW_RUN_DB_TESTS=1`.

## Verified audit gaps to keep visible

These are remaining source or environment checks, not assumptions that external configuration has been completed:

- Shopify Partner Dashboard plans/meter tiers, trial settings, Partner API permissions, and staging secrets must be configured and verified outside the repository. The inspected linked development-store billing page reported that the integration was not fully configured; do not treat code checks as live billing verification.
- The worker's `limit` is applied independently to each queue, then each claimed job is processed serially. Thus the nominal limit of 5 can claim up to 20 jobs per invocation, while the scheduler client times out at 55 seconds and claims recover only after a 15-minute lease. Exercise load, timeout, and concurrent-worker behavior before raising volume.
- Expiry reminder scans cap each shop at 500 grants without pagination. Large expiry cohorts can delay or miss reminders. Email delivery/retry itself has no service-level integration test.
- Review/reversal, Operations, and privacy pages are inspection views; there is no in-app resolution action for ambiguous financial operations or exhausted queue items. Reconcile against Shopify first; do not clear records or manually resend uncertain billing events.
- `.graphqlrc.ts` code generation targets Admin API July 2026, while `app/shopify.server.ts` and the Shopify app webhook config target October 2026. Keep generated query validation aligned when changing Shopify operations.
- The automation API accepts `enabled: true` during create although the UI leaves new rules paused. Preserve the intended review-before-activation behavior at the server boundary.
- `app/routes/_index/route.tsx` still contains template copy such as “[your app]” and “Product feature”; replace it before a public release. The product-readiness checklist also has open current-branch validation, billing-dashboard, privacy, email, and production-launch gates. Read `PRODUCT-READINESS.md`, `RELIABILITY-OPERATIONS.md`, and `PREPRODUCTION-RUNBOOK.md` before release work.
- `webhooks.products.update.tsx` exists but is not registered in `shopify.app.toml`; it currently logs the full payload if invoked. Treat it as an unused route until intentionally wired and reviewed.
