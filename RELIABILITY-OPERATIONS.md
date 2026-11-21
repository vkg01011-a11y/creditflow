# CreditFlow reliability worker

## What this adds

- Fulfillment webhooks authenticate with Shopify, persist a minimized order payload in PostgreSQL, and return HTTP 200 without waiting for reward processing.
- Customer data request, customer redaction, and shop redaction webhooks persist minimal normalized jobs and return HTTP 200. The worker performs the longer database work.
- A database-backed worker claims fulfillment and privacy jobs using PostgreSQL \`FOR UPDATE SKIP LOCKED\`.
- Claims have a 15-minute lease. A later worker can recover an expired claim.
- Retryable failures use exponential backoff (30 seconds up to one hour), capped at eight attempts.
- Fulfillment retry scheduling reuses \`WebhookEventStatus.RECEIVED\` with a future \`nextAttemptAt\`, so no new PostgreSQL enum value is required.
- Fulfillment errors are automatically retried only when no \`CreditGrant\` exists for the order. If a grant exists without a confirmed outcome, the event is moved to \`REVIEW_REQUIRED\`; the worker never blindly repeats a potentially successful Store Credit mutation.
- Customer data requests create a merchant-authenticated JSON export at \`/api/privacy-requests\` and are also visible in the embedded app's Privacy requests page.
- Customer redaction pseudonymizes CreditFlow customer/order references with HMAC, clears linked metadata, removes notifications and prior exports, and preserves transaction values needed for financial history. Pseudonymized information may still be personal data under applicable law and must be handled accordingly.
- Shop redaction removes the shop's app records and stored sessions.

## Required environment variables

- \`CREDITFLOW_WORKER_SECRET\`: random secret of at least 32 characters, used to authorize the worker endpoint.
- \`SHOPIFY_API_SECRET\`: already required for Shopify app authentication; it is also used as the HMAC key for redacted identifiers.

Never commit either secret or expose it to browser code.

## Worker scheduling

The app does not run background jobs automatically. Configure a trusted scheduler (for example, a managed cron service) to send an HTTP POST every minute to:

\`https://YOUR-APP-DOMAIN/internal/webhook-worker\`

Include this header:

\`Authorization: Bearer YOUR_CREDITFLOW_WORKER_SECRET\`

Optional batch limit:

\`/internal/webhook-worker?limit=5\`

The server clamps the batch size to 1–10 for each queue. Monitor the scheduler's HTTP status and JSON response counts. A missing secret returns HTTP 503; an invalid secret returns HTTP 401.

## Privacy export access

Open **Privacy requests** in the embedded CreditFlow app. Completed customer data requests provide a JSON export. The authenticated API also supports:

\`GET /api/privacy-requests\`

Fetch one export snapshot:

\`GET /api/privacy-requests?requestId=REQUEST_ID\`

The endpoint scopes every lookup to the authenticated shop. Treat the response as confidential personal data and transfer it to the customer through your approved privacy-response process. Do not log it or share it with third parties.

## Important deployment notes

1. Apply the Prisma migration before deploying application code.
2. Set \`CREDITFLOW_WORKER_SECRET\` before enabling the scheduler.
3. Add the compliance subscriptions by deploying the updated Shopify app configuration with \`shopify app deploy\`.
4. Verify the configured production app URL and OAuth redirect URLs separately; this change intentionally does not guess those deployment-specific values.
5. Run the worker against a development store first. Test duplicate webhook delivery, worker interruption before/after Store Credit mutation, stale leases, customer data export, customer redaction, and shop redaction.
6. Ambiguous Store Credit outcomes remain manual-review cases. The worker prefers preventing duplicate credit over automatically retrying an uncertain external mutation.
7. Scheduler operation is mandatory for queued work to progress. Do not deploy this branch to production without configuring the secret and scheduler.
8. Shopify expects compliance requests to be completed within the required time window. Monitor retrying/failed privacy jobs and resolve them promptly.

## Operational limitation

This change adds the durable queues and a protected HTTP worker endpoint; it does not create a scheduler in your hosting account. Until a scheduler is configured and verified, webhook jobs remain queued in PostgreSQL.
