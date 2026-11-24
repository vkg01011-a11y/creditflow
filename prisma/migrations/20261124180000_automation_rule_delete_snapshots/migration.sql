-- Preserve the rule configuration needed for refund reconciliation after a rule is permanently deleted.
ALTER TABLE "CreditGrant"
ADD COLUMN "ruleNameSnapshot" TEXT,
ADD COLUMN "ruleSnapshot" JSONB;

-- Backfill existing grants from their currently associated rule before making the relation nullable.
UPDATE "CreditGrant" AS credit_grant
SET
  "ruleNameSnapshot" = rule."name",
  "ruleSnapshot" = jsonb_build_object(
    'version', 1,
    'name', rule."name",
    'description', rule."description",
    'trigger', rule."trigger",
    'priority', rule."priority",
    'rewardType', rule."rewardType",
    'rewardBase', rule."rewardBase",
    'percentage', rule."percentage"::text,
    'fixedAmount', rule."fixedAmount"::text,
    'minimumOrderValue', rule."minimumOrderValue"::text,
    'maximumReward', rule."maximumReward"::text,
    'productMode', rule."productMode",
    'productIds', rule."productIds",
    'conditions', rule."conditions",
    'requirePrepaid', rule."requirePrepaid",
    'expiryDays', rule."expiryDays",
    'notifyCustomer', rule."notifyCustomer"
  )
FROM "AutomationRule" AS rule
WHERE credit_grant."ruleId" = rule."id";

ALTER TABLE "CreditGrant"
ALTER COLUMN "ruleId" DROP NOT NULL;

ALTER TABLE "CreditGrant"
DROP CONSTRAINT "CreditGrant_ruleId_fkey";

ALTER TABLE "CreditGrant"
ADD CONSTRAINT "CreditGrant_ruleId_fkey"
FOREIGN KEY ("ruleId")
REFERENCES "AutomationRule"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
