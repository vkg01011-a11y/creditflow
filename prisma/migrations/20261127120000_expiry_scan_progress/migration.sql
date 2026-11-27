ALTER TABLE "EmailNotificationSettings"
ADD COLUMN "expiryScanInProgress" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "expiryScanCursor" TEXT;
