CREATE TABLE "AutomationExecution" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "executionKey" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "orderName" TEXT,
    "ruleId" TEXT,
    "ruleNameSnapshot" TEXT NOT NULL,
    "rulePrioritySnapshot" INTEGER,
    "trigger" TEXT NOT NULL DEFAULT 'ORDER_FULFILLED',
    "status" VARCHAR(32) NOT NULL,
    "reason" VARCHAR(100) NOT NULL,
    "conditions" JSONB,
    "orderSubtotal" DECIMAL(20,6),
    "eligibleSubtotal" DECIMAL(20,6),
    "rewardBase" VARCHAR(32),
    "rewardBaseAmount" DECIMAL(20,6),
    "estimatedReward" DECIMAL(20,6),
    "currencyCode" VARCHAR(3),
    "creditGrantId" TEXT,
    "grantAmount" DECIMAL(20,6),
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "errorMessage" VARCHAR(1000),
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutomationExecution_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AutomationExecution_shop_fkey"
      FOREIGN KEY ("shop") REFERENCES "Merchant"("shop")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AutomationExecution_executionKey_key"
  ON "AutomationExecution"("executionKey");
CREATE INDEX "AutomationExecution_shop_evaluatedAt_id_idx"
  ON "AutomationExecution"("shop", "evaluatedAt" DESC, "id" DESC);
CREATE INDEX "AutomationExecution_shop_ruleId_evaluatedAt_idx"
  ON "AutomationExecution"("shop", "ruleId", "evaluatedAt" DESC);
CREATE INDEX "AutomationExecution_shop_status_evaluatedAt_idx"
  ON "AutomationExecution"("shop", "status", "evaluatedAt" DESC);
CREATE INDEX "AutomationExecution_shop_orderGid_idx"
  ON "AutomationExecution"("shop", "orderGid");


-- Backfill a useful historical timeline from existing grant records.
-- Older grants have no stored condition outcomes, so those fields remain NULL.
INSERT INTO "AutomationExecution" (
  "id",
  "shop",
  "executionKey",
  "orderGid",
  "orderName",
  "ruleId",
  "ruleNameSnapshot",
  "rulePrioritySnapshot",
  "trigger",
  "status",
  "reason",
  "conditions",
  "orderSubtotal",
  "eligibleSubtotal",
  "rewardBase",
  "rewardBaseAmount",
  "estimatedReward",
  "currencyCode",
  "creditGrantId",
  "grantAmount",
  "attemptCount",
  "errorMessage",
  "evaluatedAt",
  "completedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  md5('credit-grant-history:' || grant."id"),
  grant."shop",
  CASE
    WHEN grant."ruleId" IS NULL
      THEN 'automation-execution-legacy:' || grant."eventKey"
    ELSE grant."eventKey"
  END,
  grant."orderGid",
  NULL,
  grant."ruleId",
  COALESCE(
    grant."ruleNameSnapshot",
    grant."ruleSnapshot"->>'name',
    'Historical automation'
  ),
  CASE
    WHEN (grant."ruleSnapshot"->>'priority') ~ '^[0-9]+$'
      THEN (grant."ruleSnapshot"->>'priority')::INTEGER
    ELSE NULL
  END,
  COALESCE(grant."ruleSnapshot"->>'trigger', 'ORDER_FULFILLED'),
  CASE grant."status"::TEXT
    WHEN 'ISSUED' THEN 'ISSUED'
    WHEN 'REVERSED' THEN 'ISSUED'
    WHEN 'PARTIALLY_REVERSED' THEN 'ISSUED'
    WHEN 'FAILED' THEN 'FAILED'
    WHEN 'REVIEW_REQUIRED' THEN 'REVIEW_REQUIRED'
    ELSE 'PROCESSING'
  END,
  'LEGACY_GRANT_BACKFILLED',
  NULL,
  NULL,
  NULL,
  grant."ruleSnapshot"->>'rewardBase',
  grant."rewardBaseAmount",
  grant."amount",
  grant."currencyCode",
  grant."id",
  CASE
    WHEN grant."status"::TEXT IN ('ISSUED', 'REVERSED', 'PARTIALLY_REVERSED')
      THEN grant."amount"
    ELSE NULL
  END,
  1,
  NULL,
  grant."createdAt",
  CASE
    WHEN grant."status"::TEXT IN ('ISSUED', 'REVERSED', 'PARTIALLY_REVERSED', 'FAILED', 'REVIEW_REQUIRED')
      THEN COALESCE(grant."issuedAt", grant."updatedAt")
    ELSE NULL
  END,
  grant."createdAt",
  grant."updatedAt"
FROM "CreditGrant" AS grant
ON CONFLICT ("executionKey") DO NOTHING;
