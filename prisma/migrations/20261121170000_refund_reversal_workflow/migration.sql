
CREATE TYPE "CreditReversalStatus" AS ENUM (
  'PROCESSING',
  'REVERSED',
  'NO_REVERSAL',
  'REVIEW_REQUIRED'
);

ALTER TABLE "CreditGrant"
  ADD COLUMN "rewardBaseAmount" DECIMAL(20,6);

CREATE TABLE "CreditReversal" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "refundGid" TEXT NOT NULL,
  "webhookId" TEXT NOT NULL,
  "orderGid" TEXT NOT NULL,
  "creditGrantId" TEXT NOT NULL,
  "refundedBaseAmount" DECIMAL(20,6) NOT NULL,
  "amount" DECIMAL(20,6) NOT NULL,
  "currencyCode" VARCHAR(3) NOT NULL,
  "status" "CreditReversalStatus" NOT NULL DEFAULT 'PROCESSING',
  "shopifyTransactionGid" TEXT,
  "errorMessage" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditReversal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreditReversal_shop_refundGid_creditGrantId_key"
  ON "CreditReversal" ("shop", "refundGid", "creditGrantId");

CREATE INDEX "CreditReversal_shop_status_createdAt_idx"
  ON "CreditReversal" ("shop", "status", "createdAt");

CREATE INDEX "CreditReversal_creditGrantId_status_idx"
  ON "CreditReversal" ("creditGrantId", "status");

ALTER TABLE "CreditReversal"
  ADD CONSTRAINT "CreditReversal_shop_fkey"
  FOREIGN KEY ("shop") REFERENCES "Merchant"("shop")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CreditReversal"
  ADD CONSTRAINT "CreditReversal_creditGrantId_fkey"
  FOREIGN KEY ("creditGrantId") REFERENCES "CreditGrant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
