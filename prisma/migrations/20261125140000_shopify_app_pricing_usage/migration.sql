CREATE TYPE "BillingUsageEventStatus" AS ENUM (
  'QUEUED', 'PROCESSING', 'SENT', 'SKIPPED', 'REVIEW_REQUIRED'
);

CREATE TABLE "BillingUsageEvent" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "orderGid" TEXT NOT NULL,
  "planAtOccurrence" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "BillingUsageEventStatus" NOT NULL DEFAULT 'QUEUED',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "sentAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingUsageEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingUsageEvent_shop_fkey" FOREIGN KEY ("shop")
    REFERENCES "Merchant"("shop") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BillingUsageEvent_idempotencyKey_key"
  ON "BillingUsageEvent"("idempotencyKey");
CREATE UNIQUE INDEX "BillingUsageEvent_shop_orderGid_key"
  ON "BillingUsageEvent"("shop", "orderGid");
CREATE INDEX "BillingUsageEvent_status_nextAttemptAt_idx"
  ON "BillingUsageEvent"("status", "nextAttemptAt");
CREATE INDEX "BillingUsageEvent_shop_status_nextAttemptAt_idx"
  ON "BillingUsageEvent"("shop", "status", "nextAttemptAt");
