# CreditFlow product-readiness checklist

Updated: 2026-11-23

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
- [ ] Validate the customer-email schema/migration and email template tests on the current branch head.
- [ ] Confirm TypeScript, ESLint, production build, Render Blueprint YAML validation, and Docker build for the current branch head.
- [ ] Apply any CI-required fixes and confirm the final branch head is green.

## Remaining application reliability tests

- [ ] Test refund-before-fulfillment worker ordering.
- [ ] Test insufficient Store Credit, missing currency/product data, legacy grant, and worker interruption; verify manual-review state and no blind debit retry.
- [ ] Test stale worker lease recovery and concurrent worker invocations.
- [ ] Verify customer data request exports reversal and refund-event records.
- [ ] Verify customer redaction removes/pseudonymizes customer-linked refund references.
- [ ] Verify shop redaction removes shop-owned records and sessions.
- [ ] Test install, reauthorization/scope changes, uninstall/reinstall, offline token expiry, and app removal.

## Customer email release gates

- [x] Implement Shopify-native versus CreditFlow-branded issue email selection without sending both for one grant.
- [x] Implement merchant email design controls and live preview.
- [x] Implement opt-in expiry reminders with Shopify remainingAmount verification and idempotent queued delivery.
- [ ] Configure Resend API key and a verified sender domain in staging.
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

## Commercial and Shopify App Store gates

CreditFlow's current intended launch direction is a free core app, with optional external Pikmora implementation services and qualified merchant referrals as separate revenue channels. Do not add Shopify Billing to the initial release unless this strategy changes.

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
