# Pikmora Perks performance and scaling optimization

## Development HAR baseline

The supplied development HAR showed no full `Document` reload during the captured internal navigation. It recorded three `/app.data` requests averaging about 0.945 seconds and three `/app/automations.data` requests averaging about 0.992 seconds; the requests were HTTP 200 and their time was predominantly server wait/TTFB. The initial route-manifest request was about 1.24 seconds. These are development-tunnel measurements, not production SLAs.

The expected first comparison is fewer `/app.data` calls during navigation and no product-catalogue GraphQL query on ordinary Automations page loads. The Automations child loader still runs so it can authenticate and fetch current rule data.

## Included changes

- The authenticated `/app` shell loader skips revalidation only for navigation that stays inside `/app`. Dashboard and Automations child loaders and API resource routes retain their own Shopify authentication.
- Automation writes suppress React Router's automatic successful-action revalidation and perform one explicit revalidation after the action result, avoiding duplicate route-loader work.
- Automations route loading no longer performs a Merchant upsert or fetches the product catalogue. It loads tenant-scoped automation rules and cached store metadata only.
- Product selection is on-demand through the authenticated `/api/products` route. A tested domain helper converts merchant input into quoted plain-text Shopify search terms, supports 50-product cursor-paginated pages, and hydrates previously selected products when editing a rule.
- Selected product labels are retained while the merchant changes search terms or loads additional pages.
- Shopify store name/currency are cached in the Merchant row for 24 hours. An atomic conditional update provides a 60-second refresh lease shared across app instances; failed refreshes serve stale metadata and set a shared five-minute retry backoff. Currency is never guessed or replaced with INR.
- API automation reads/writes still authenticate the Shopify admin session but no longer run a Merchant upsert on every request. Installation activation remains in the `afterAuth` hook.
- Dashboard distinct-customer counting is performed by PostgreSQL rather than materializing every grouped customer row in Node.js.
- Additive indexes support dashboard date/direction aggregates, recent activity sort, and automation list sort.

## Database migration

This patch adds migration:

`20261121130000_optimize_shop_metadata_and_dashboard_indexes`

It adds two nullable Merchant metadata timestamps and three indexes, and replaces the shorter AutomationRule archivedAt index with a compound index matching the list sort. Indexes are built with PostgreSQL `CREATE INDEX CONCURRENTLY` so normal writes can continue during deployment; the migration uses a five-second lock timeout for the short metadata-column change. PostgreSQL does not allow concurrent index operations inside a transaction, and Prisma Migrate's PostgreSQL migrations are not wrapped in a transaction by default. Do not add `BEGIN`/`COMMIT` around this migration. It does not alter balances, credit grants, Shopify sessions, or existing ledger rows.

Make and validate a fresh PostgreSQL backup before applying it. Use `npx.cmd prisma migrate deploy`, not `migrate reset`.

## Important design limits

- The automation rules list is still loaded as one list per merchant. Add server-side pagination or an enforced rule limit before a store can accumulate very large numbers of rules.
- Product selection fetches 50 products per page and relies on Shopify's Admin GraphQL search and cursor pagination. The Admin API query budget still applies, and product selection must be tested against representative stores.
- The metadata cache and short refresh lease are shared across application instances through PostgreSQL. The five-minute failure backoff avoids repeated Shopify requests during outages. If the instance holding the 60-second lease crashes, another instance can retry after the lease expires.
- This patch does not add a distributed job queue, worker fleet, Redis, deployment-specific connection pooling, multi-region hosting, or automatic failover. These require decisions about the eventual hosting and database providers.
- Fulfillment webhook processing, idempotency, retry recovery, refunds/reversals, privacy webhooks, notification delivery, and production monitoring still require end-to-end tests before App Store launch.
- The HAR baseline came from a local development tunnel and PostgreSQL instance. Re-measure on production-like hosting; a Cloudflare tunnel is not a production performance benchmark.

## Files changed

- `app/routes/app.tsx`
- `app/services/merchant.server.ts`
- `app/routes/app.automations.tsx`
- `app/routes/api.automations.ts`
- `app/routes/api.products.ts` (new)
- `app/domain/shopify-product-search.mjs` and `.d.mts` (new)
- `tests/shopify-product-search.test.mjs` (new)
- `app/routes/app._index.tsx`
- `prisma/schema.prisma`
- `prisma/migrations/20261121130000_optimize_shop_metadata_and_dashboard_indexes/migration.sql` (new)
