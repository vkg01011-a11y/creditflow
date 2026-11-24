-- Preserve the rule configuration needed for refund reconciliation after a rule is permanently deleted.
ALTER TABLE "CreditGrant"
ADD COLUMN "ruleNameSnapshot" TEXT,
ADD COLUMN "ruleSnapshot" JSONB;

-- Backfill existing grants from their currently associated rule before making the relation nullable.
UPDATE "CreditGrant" AS credit_grant
SET
  "ruleNameSnapshot" = automation_rule."name",
  "ruleSnapshot" = jsonb_build_object(
    'version', 1,
    'name', automation_rule."name",
    'description', automation_rule."description",
    'trigger', automation_rule."trigger",
    'priority', automation_rule."priority",
    'rewardType', automation_rule."rewardType",
    'rewardBase', automation_rule."rewardBase",
    'percentage', automation_rule."percentage"::text,
    'fixedAmount', automation_rule."fixedAmount"::text,
    'minimumOrderValue', automation_rule."minimumOrderValue"::text,
    'maximumReward', automation_rule."maximumReward"::text,
    'productMode', automation_rule."productMode",
    'productIds', automation_rule."productIds",
    'conditions', automation_rule."conditions",
    'requirePrepaid', automation_rule."requirePrepaid",
    'expiryDays', automation_rule."expiryDays",
    'notifyCustomer', automation_rule."notifyCustomer"
  )
FROM "AutomationRule" AS automation_rule
WHERE credit_grant."ruleId" = automation_rule."id";

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
