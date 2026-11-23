CREATE TYPE "CreditIssuedEmailMode" AS ENUM ('SHOPIFY_NATIVE', 'CREDITFLOW_CUSTOM', 'DISABLED');

ALTER TYPE "NotificationStatus" ADD VALUE 'SKIPPED';

ALTER TABLE "CreditGrant"
ADD COLUMN "expiresAt" TIMESTAMP(3);

ALTER TABLE "Notification"
ADD COLUMN "metadata" JSONB,
ADD COLUMN "lockedAt" TIMESTAMP(3),
ADD COLUMN "lockedBy" TEXT;

CREATE INDEX "Notification_status_scheduledAt_idx"
ON "Notification"("status", "scheduledAt");

CREATE TABLE "EmailNotificationSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "issuedEmailMode" "CreditIssuedEmailMode" NOT NULL DEFAULT 'SHOPIFY_NATIVE',
    "expiryReminderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "expiryReminderDays" JSONB NOT NULL DEFAULT '[7,1]',
    "senderName" VARCHAR(100),
    "replyToEmail" VARCHAR(254),
    "logoUrl" VARCHAR(2048),
    "accentColor" VARCHAR(7) NOT NULL DEFAULT '#176B5B',
    "issuedSubject" VARCHAR(180) NOT NULL DEFAULT 'A little something for your next order',
    "issuedHeadline" VARCHAR(120) NOT NULL DEFAULT 'You''ve got store credit!',
    "issuedMessage" VARCHAR(500) NOT NULL DEFAULT 'Thank you for shopping with {{ shop_name }}. We''ve added {{ credit_amount }} to your store credit account.',
    "issuedCtaLabel" VARCHAR(40) NOT NULL DEFAULT 'Shop now',
    "expirySubject" VARCHAR(180) NOT NULL DEFAULT 'Your store credit is about to expire',
    "expiryHeadline" VARCHAR(120) NOT NULL DEFAULT 'A little reminder before it expires',
    "expiryMessage" VARCHAR(500) NOT NULL DEFAULT 'You still have {{ remaining_amount }} in store credit. Use it before {{ expiry_date }}.',
    "expiryCtaLabel" VARCHAR(40) NOT NULL DEFAULT 'Use my credit',
    "footerText" VARCHAR(240),
    "lastExpiryScanAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailNotificationSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailNotificationSettings_shop_key"
ON "EmailNotificationSettings"("shop");

CREATE INDEX "EmailNotificationSettings_expiryReminderEnabled_lastExpiryScanAt_idx"
ON "EmailNotificationSettings"("expiryReminderEnabled", "lastExpiryScanAt");

ALTER TABLE "EmailNotificationSettings"
ADD CONSTRAINT "EmailNotificationSettings_shop_fkey"
FOREIGN KEY ("shop") REFERENCES "Merchant"("shop")
ON DELETE CASCADE ON UPDATE CASCADE;
