-- CreditFlow performance optimization migration
-- Transaction-compatible version for Prisma migration deployment.

SET lock_timeout = '5s';

-- Shop metadata cache fields
ALTER TABLE "Merchant"
  ADD COLUMN IF NOT EXISTS "shopMetadataSyncedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "shopMetadataRetryAfter" TIMESTAMP(3);

-- Remove previous versions of indexes if they exist.
DROP INDEX IF EXISTS "CreditLedgerEntry_shop_direction_createdAt_idx";
DROP INDEX IF EXISTS "CreditLedgerEntry_shop_createdAt_idx";
DROP INDEX IF EXISTS "AutomationRule_shop_archivedAt_priority_createdAt_idx";

-- Credit ledger query optimization
CREATE INDEX "CreditLedgerEntry_shop_direction_createdAt_idx"
  ON "CreditLedgerEntry" ("shop", "direction", "createdAt");

CREATE INDEX "CreditLedgerEntry_shop_createdAt_idx"
  ON "CreditLedgerEntry" ("shop", "createdAt");

-- Automation listing optimization
CREATE INDEX "AutomationRule_shop_archivedAt_priority_createdAt_idx"
  ON "AutomationRule" ("shop", "archivedAt", "priority", "createdAt" DESC);

-- Replace the old index with the more useful compound index.
DROP INDEX IF EXISTS "AutomationRule_shop_archivedAt_idx";

RESET lock_timeout;