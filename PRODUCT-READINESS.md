# CreditFlow product-readiness checklist

Updated: 2026-11-27

This is an engineering readiness tracker, not a claim that the app is approved for production or the Shopify App Store.

## Implemented on the feature branch

- [x] Embedded Shopify React Router app shell.
- [x] PostgreSQL persistence with Prisma.
- [x] Merchant-scoped automation rules and product selection.
- [x] Permanent automation-rule deletion for paused rules, with immutable grant snapshots and preserved Shopify Store Credit/refund/ledger history.
- [x] Exact currency arithmetic with integer minor units for reward calculations.
- [x] Shopify native Store Credit issuance.
- [x] Durable fulfillment webhook inbox and worker queue.
- [x] Duplicate protection and conservative handling of uncertain credit issuance.
- [x] Durable customer data request, customer redaction, and shop redaction queues.
- [x] Customer data export and pseudonymization/redaction routines.
- [x] Refund webhook inbox and proportional cashback reversal logic.
- [x] Unique refund/grant reservations before Shopify Store Credit debit.
- [x] Manual-review state for uncertain debit outcomes and legacy grants without a stored reward basis.
- [x] Refund reversals history page.
- [x] Operations page for webhook/privacy queue visibility.
- [x] New automation rules start paused.
- [x] Runtime configuration readiness checks that do not expose secret values.
- [x] Liveness endpoint (`/healthz`) and database/config readiness endpoint (`/readyz`).
- [x] One-shot worker runner for managed cron/scheduler services.
- [x] Persistent worker heartbeat records, stale detection, and Operations visibility.
- [x] Docker build definition and secret-excluding Docker build context.
- [x] Deployment instructions for release migrations, web process, and scheduled worker.
- [x] Render Blueprint for a feature-branch staging web service, private Postgres, and one-minute cron worker.
- [x] Merchant-facing Customer emails settings with live issued/expiry email preview, logo, colour, sender, reply-to, subjects, body, and CTA customization.
- [x] Mutually exclusive Shopify-native or CreditFlow-branded credit-issued email modes.
- [x] Resend delivery queue with retry and idempotency protection.
- [x] Opt-in 7/3/1-day credit-expiry reminders, checked against Shopify's exact remaining credit transaction amount before delivery.
- [x] Operations visibility for customer email queue states and failures.
- [x] Operations visibility for Shopify usage billing queue states, without showing customer/order identifiers.
- [x] Merchant billing page keeps Shopify-hosted plan management available and explains status outages in plain language.
- [x] Plan page shows trial countdown, included order allowance, usage returned by Shopify, cancellation-at-cycle-end status, and explains the overage model without presenting it as a final invoice.
- [x] Durable `REVIEW_REQUIRED` reservation for fulfilled-order billing eligibility when the Partner API or cycle/plan data is uncertain.
- [x] Plan/trial/cycle revalidation before App Events submission; pending plan changes require reconciliation.
- [x] Stable billing idempotency key and bounded App Events/token/Partner API request timeouts.
- [x] New automation rules start paused through both the merchant UI and create API, even if an API caller submits `enabled: true`.
- [x] Editable reward templates and multiple condition groups with AND/OR logic.
- [x] Branded email test send checks plan entitlement and provider configuration and describes provider acceptance accurately.
- [x] Expiry scans use a persisted cursor, page-size limit, per-run work cap, and per-shop lease for crash recovery.
- [x] Worker claims share a single invocation limit across webhook, privacy, notification and billing queues, with rotating remainder allocation.
- [x] Merchant support form and configurable support-email link report when staging email settings are absent.
- [x] Dashboard labels CreditFlow credit issuance and reversals separately and explains that current records do not establish native balance, redemption or expiry totals.

## Verified development-store flows

These checks were performed against the connected development store and local PostgreSQL. They are not a substitute for a clean-install and privacy compliance test pass.

- [x] Create a cashback rule paused, then deliberately enable the QA rule.
- [x] Fulfill an eligible order and verify native Shopify Store Credit plus CreditFlow grant/ledger records.
- [x] Replay the fulfillment webhook and confirm the reward is not duplicated.
- [x] Process a partial merchandise refund and verify the proportional native Store Credit debit.
- [x] Process a second partial refund and verify only the remaining incremental debit.
- [x] Confirm cumulative refunds reverse the full original ₹1.00 reward, with two ₹0.50 Shopify debit transactions.
- [x] Replay a refund webhook and confirm one reversal reservation and one debit ledger entry for that delivery.
- [x] Confirm old ambiguous/invalid refund events remain in manual review without a blind debit.

## Automated validation status

- [x] Previous production-operations baseline passed clean PostgreSQL migration deployment, tests, TypeScript, ESLint, production build, and Docker image build.
- [x] Current working tree: Prisma schema validation, TypeScript, ESLint, production build, and Render Blueprint YAML parse passed; `npm test` passed 92 tests with the database integration test skipped.
- [ ] Build the production Docker image (Docker CLI is unavailable in this development environment).
- [ ] Run clean PostgreSQL migration deployment and the database integration test for the current branch head.
- [ ] Confirm the GitHub Actions checks are green for the pushed branch head.

## Remaining application reliability tests

- [ ] Test refund-before-fulfillment worker ordering.
- [ ] Test insufficient Store Credit, missing currency/product data, legacy grant, and worker interruption; verify manual-review state and no blind debit retry.
- [ ] Test stale worker lease recovery and concurrent worker invocations.
- [ ] Integration-test expiry-scan cursor continuation, crash recovery, and reset when reminder settings change.
- [ ] Verify customer data request exports reversal and refund-event records.
- [ ] Verify customer redaction removes/pseudonymizes customer-linked refund references.
- [ ] Verify shop redaction removes shop-owned records and sessions.
- [ ] Test install, reauthorization/scope changes, uninstall/reinstall, offline token expiry, and app removal.

## Customer email release gates

- [x] Implement Shopify-native versus CreditFlow-branded issue email selection without sending both for one grant.
- [x] Implement merchant email design controls and live preview.
- [x] Implement a plan-gated test email send for the saved merchant design.
- [x] Implement opt-in expiry reminders with Shopify remainingAmount verification and idempotent queued delivery.
- [ ] Configure Resend API key and a verified sender domain in staging.
- [ ] Configure a real `CREDITFLOW_SUPPORT_EMAIL` in staging; the environment template intentionally contains no support address.
- [ ] Reauthorize the staging app with Store Credit account/transaction read scopes.
- [ ] Send and review test credit-issued and expiry emails in a real inbox across desktop/mobile clients.
- [ ] Verify suppression after the credit has been spent or expiry has been removed.
- [ ] Verify provider rejection, network timeout, retry, and duplicate delivery behavior.

## Pre-production infrastructure gates

- [x] Add a Render Blueprint pinned to the feature branch.
- [x] Add a container build definition.
- [x] Add a safe environment template.
- [x] Add process liveness and runtime/database readiness probes.
- [x] Add a one-shot scheduled worker command.
- [ ] Choose the managed hosting project and configure the real HTTPS app URL.
- [ ] Provision production PostgreSQL with private connectivity, automated backups, and a tested restore.
- [ ] Configure production Shopify API credentials, required Store Credit read/write scopes, and a 32+ character worker secret.
- [ ] Configure Resend API key and verified sender domain if branded email mode is enabled.
- [ ] Configure a one-minute scheduled worker using `npm run worker:once`.
- [ ] Verify `/healthz` and `/readyz` after deployment.
- [ ] Configure centralized logs, error monitoring, uptime checks, and alerts for queue age, failures, and review-required financial operations.
- [ ] Establish retention and deletion policies for webhook payloads, audit metadata, privacy exports, and financial records.
- [ ] Define a rollback procedure that does not reverse or drop applied database migrations.

## Shopify App Pricing implementation and configuration

- [x] Add Partner API active-subscription lookup and plan-handle mapping.
- [x] Add durable per-shop/per-order usage outbox with stable hashed idempotency keys.
- [x] Add App Events API sender and trial / Business / billing-cycle / plan-snapshot guards.
- [x] Add worker retries and review-required state for unresolved usage deliveries.
- [x] Add pure billing-policy tests for plan changes, cycle boundaries, trial status, and idempotency.
- [x] Persist unknown billing eligibility as a review row without blocking rewards.
- [x] Expose billing queue counts and review items in Operations and scheduled-worker logs.
- [x] Add the Plan & usage page and Shopify-hosted plan-selection link.
- [x] Enforce branded-email entitlement in settings, reward issuance, and delivery worker.
- [ ] Create public plans with recurring item handles `starter_plan`, `growth_plan`, `professional_plan`, `business_plan`.
- [ ] Configure `orders_processed` as graduated pricing: 1–100 / 1–300 / 1–1,000 units at $0.00, then each additional unit at $0.10 on Starter / Growth / Professional; Business has no meter.
- [ ] Set 14-day trials on Growth, Professional, and Business; Starter has no trial.
- [ ] Configure Partner API client with Manage apps permission and set Partner ID/token, app GID, and app secrets in staging.
- [ ] The linked development-store billing page reported an incomplete billing integration on 2026-11-26; configure secrets and verify plan selection before claiming live billing works.
- [ ] Verify subscription item handles and no-charge plan selection on a development store.
- [ ] Verify duplicate fulfillment webhooks produce one usage row and one App Events idempotency key.
- [ ] Verify trial usage is not submitted, Business sends no events, and events fall within the active billing cycle.
- [ ] Inspect Dev Dashboard App Billing Event logs; HTTP 202 is receipt, not final billing validation.

## Commercial and Shopify App Store gates

CreditFlow uses Shopify App Pricing. Starter is $0/month with 100 evaluated orders then $0.10/order; Growth is $9/month with 300 then $0.10/order; Professional is $19/month with 1,000 then $0.10/order; Business is $49/month with unlimited orders and no overage. Growth, Professional, and Business have a 14-day trial; Starter is free forever. Branded email and expiry reminders are Professional/Business features.

- [ ] Confirm the launch feature boundary and referral disclosures.
- [ ] Verify Shopify API scopes are minimal and accurately described.
- [ ] Verify privacy compliance webhook subscriptions are deployed and tested.
- [ ] Publish accessible privacy policy, terms, support contact, and support documentation.
- [ ] Complete App Store listing assets, feature descriptions, screenshots, and review notes.
- [ ] Review Shopify policy compliance and data handling with appropriate legal advice.

## Safety invariants

1. Shopify Native Store Credit is the authoritative customer balance.
2. CreditFlow never calculates or displays a wallet balance by summing its own ledger.
3. A credit or debit mutation with an uncertain external outcome is not blindly repeated.
4. Every financial operation is scoped to the authenticated Shopify shop.
5. Customer and shop privacy requests must remain observable until completed or escalated.
6. Production deployment and migration must be deliberate, backed up, and separately validated.
