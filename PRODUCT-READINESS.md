# CreditFlow product-readiness checklist

Updated: 2026-11-21

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

## Validation required on the current branch

- [ ] Pull the latest `feature/reliability-webhook-queue` commit locally.
- [ ] Run Prisma validation and generate client.
- [ ] Run all unit tests, TypeScript, ESLint, and production build.
- [ ] Back up the development PostgreSQL database.
- [ ] Apply the refund-reversal migration to the development database.
- [ ] Verify migration status is current.

## Shopify development-store test matrix

- [ ] Create a cashback rule and verify it is initially paused.
- [ ] Enable the rule deliberately and verify it only matches intended orders.
- [ ] Verify percentage/fixed reward calculation, cap, expiry, product selection, and conditions.
- [ ] Fulfill an eligible customer order and verify the Shopify native Store Credit transaction and CreditFlow grant/ledger records.
- [ ] Deliver the same fulfillment webhook twice and verify one reward only.
- [ ] Refund part of an eligible order and verify the proportional Store Credit debit.
- [ ] Process a second partial refund and verify only the incremental debit is made.
- [ ] Fully refund an order and verify cumulative reversal is capped at the original grant.
- [ ] Redeliver a refund webhook and verify there is no duplicate debit.
- [ ] Test refunds arriving before the fulfillment worker completes.
- [ ] Test insufficient Store Credit, missing currency/product data, legacy grant, and worker interruption; verify manual-review state and no blind debit retry.
- [ ] Test stale worker lease recovery and concurrent worker invocations.
- [ ] Verify customer data request exports reversal and refund-event records.
- [ ] Verify customer redaction removes/pseudonymizes customer-linked refund references.
- [ ] Verify shop redaction removes shop-owned records and sessions.

## Production blockers

### Commercial and billing

- [ ] Decide pricing model, plan limits, trial duration, and free/paid feature boundaries.
- [ ] Implement Shopify billing or managed pricing integration as appropriate.
- [ ] Enforce plan entitlements server-side, not only in the user interface.
- [ ] Implement billing lifecycle handling (approval, active, declined, cancellation, downgrade, uninstall).

### Infrastructure and operations

- [ ] Choose production host and set the true app URL and OAuth redirect URLs.
- [ ] Provision production PostgreSQL and tested backup/restore procedures.
- [ ] Configure `CREDITFLOW_WORKER_SECRET` (32+ random characters).
- [ ] Configure external scheduled POST to `/internal/webhook-worker` every minute.
- [ ] Monitor scheduler response codes, queue age, failed jobs, review-required jobs, and privacy request deadlines.
- [ ] Define how operators investigate uncertain Shopify credit mutations before manually reconciling them.
- [ ] Add alerting for worker outages, webhook backlog, database errors, and privacy deadlines.
- [ ] Establish a retention policy for webhook payloads, audit records, exports, and financial metadata.

### Shopify App Store readiness

- [ ] Verify Shopify API scopes are minimal and accurately described.
- [ ] Verify privacy compliance subscriptions are deployed and tested.
- [ ] Publish accessible privacy policy, terms, support contact, and support documentation.
- [ ] Complete App Store listing assets, feature descriptions, screenshots, and review notes.
- [ ] Test install, reauthorization/scope changes, uninstall/reinstall, token expiry, and app removal.
- [ ] Review Shopify policy compliance and data handling with appropriate legal advice.

## Safety invariants

1. Shopify Native Store Credit is the authoritative customer balance.
2. CreditFlow never calculates or displays a wallet balance by summing its own ledger.
3. A credit or debit mutation with an uncertain external outcome is not blindly repeated.
4. Every financial operation is scoped to the authenticated Shopify shop.
5. Customer and shop privacy requests must remain observable until completed or escalated.
6. Production deployment and migration must be deliberate, backed up, and separately validated.
