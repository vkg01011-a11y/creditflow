-- Durable, minimized webhook inbox and privacy request processing.
-- Existing webhook statuses are reused: RECEIVED plus nextAttemptAt represents
-- a queued/retry-waiting job, avoiding an ALTER TYPE enum-value transaction hazard.

ALTER TABLE "WebhookEvent"
  ADD COLUMN "payload" JSONB,
  ADD COLUMN "lockedAt" TIMESTAMP(3),
  ADD COLUMN "lockedBy" TEXT;

-- Events created by the old synchronous handler have no queued payload.
-- Do not let the new worker interpret them as fresh work.
UPDATE "WebhookEvent"
SET
  "status" = 'REVIEW_REQUIRED',
  "lastError" = COALESCE(
    "lastError",
    'Legacy webhook event has no persisted payload and requires manual review.'
  )
WHERE "status" IN ('RECEIVED', 'PROCESSING')
  AND "payload" IS NULL;

DROP INDEX IF EXISTS "WebhookEvent_status_nextAttemptAt_idx";

CREATE INDEX "WebhookEvent_status_nextAttemptAt_receivedAt_idx"
  ON "WebhookEvent" ("status", "nextAttemptAt", "receivedAt");

CREATE TYPE "PrivacyRequestType" AS ENUM (
  'CUSTOMERS_DATA_REQUEST',
  'CUSTOMERS_REDACT',
  'SHOP_REDACT'
);

CREATE TYPE "PrivacyRequestStatus" AS ENUM (
  'RECEIVED',
  'PROCESSING',
  'RETRY_PENDING',
  'COMPLETED',
  'FAILED',
  'REVIEW_REQUIRED'
);

CREATE TABLE "PrivacyRequest" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "webhookId" TEXT NOT NULL,
  "type" "PrivacyRequestType" NOT NULL,
  "status" "PrivacyRequestStatus" NOT NULL DEFAULT 'RECEIVED',
  "customerKey" TEXT,
  "requestedOrderIds" JSONB,
  "payload" JSONB,
  "dataSnapshot" JSONB,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "nextAttemptAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,

  CONSTRAINT "PrivacyRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrivacyRequest_shop_webhookId_key"
  ON "PrivacyRequest" ("shop", "webhookId");

CREATE INDEX "PrivacyRequest_shop_type_receivedAt_idx"
  ON "PrivacyRequest" ("shop", "type", "receivedAt" DESC);

CREATE INDEX "PrivacyRequest_shop_customerKey_idx"
  ON "PrivacyRequest" ("shop", "customerKey");

CREATE INDEX "PrivacyRequest_status_nextAttemptAt_receivedAt_idx"
  ON "PrivacyRequest" ("status", "nextAttemptAt", "receivedAt");
