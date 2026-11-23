# CreditFlow product-readiness checklist

Updated: 2026-11-23

This is an engineering readiness tracker, not a claim that the app is approved for production or the Shopify App Store.

## Implemented on the feature branch

- [x] Embedded Shopify React Router app shell.
- [x] PostgreSQL persistence with Prisma.
- [x] Merchant-scoped automation rules and product selection.
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
- [x] Docker build definition and secret-excluding Docker build context.
- [x] Deployment instructions for release migrations, web process, and scheduled worker.

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

- [x] Baseline CI previously passed Prisma migration deployment, 35 tests, TypeScript, ESLint, and production build at the earlier reliability commit.
- [ ] Run CI for the current production-operations upgrade, including readiness tests and Docker image build.
- [ ] Apply any CI-required fixes and confirm the final branch head is green.

## Remaining application reliability tests

- [ ] Test refund-before-fulfillment worker ordering.
- [ ] Test insufficient Store Credit, missing currency/product data, legacy grant, and worker interruption; verify manual-review state and no blind debit retry.
- [ ] Test stale worker lease recovery and concurrent worker invocations.
- [ ] Verify customer data request exports reversal and refund-event records.
- [ ] Verify customer redaction removes/pseudonymizes customer-linked refund references.
- [ ] Verify shop redaction removes shop-owned records and sessions.
- [ ] Test install, reauthorization/scope changes, uninstall/reinstall, offline token expiry, and app removal.

## Pre-production infrastructure gates

- [x] Add a container build definition.
- [x] Add a safe environment template.
- [x] Add process liveness and runtime/database readiness probes.
- [x] Add a one-shot scheduled worker command.
- [ ] Choose the managed hosting project and configure the real HTTPS app URL.
- [ ] Provision production PostgreSQL with private connectivity, automated backups, and a tested restore.
- [ ] Configure production Shopify API credentials, scopes, and a 32+ character worker secret.
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
