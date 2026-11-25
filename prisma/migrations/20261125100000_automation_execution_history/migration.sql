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
