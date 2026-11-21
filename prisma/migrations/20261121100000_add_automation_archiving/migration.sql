-- Add archived-state support to automation rules.
-- IF NOT EXISTS keeps this safe for development databases where the column
-- or index may already have been created manually.
ALTER TABLE "AutomationRule"
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "AutomationRule_shop_archivedAt_idx"
  ON "AutomationRule"("shop", "archivedAt");
