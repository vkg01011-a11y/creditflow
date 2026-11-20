-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('ACTIVE', 'UNINSTALLED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CreditGrantStatus" AS ENUM ('PROCESSING', 'ISSUED', 'FAILED', 'REVIEW_REQUIRED', 'REVERSED', 'PARTIALLY_REVERSED');

-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM ('CASHBACK_CREDIT', 'MANUAL_CREDIT', 'MANUAL_DEBIT', 'CREDIT_REDEMPTION', 'REFUND_REVERSAL', 'REWARD_REVERSAL', 'EXPIRY', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('CREDIT_ISSUED', 'CREDIT_REDEEMED', 'CREDIT_DEDUCTED', 'CREDIT_EXPIRING', 'CREDIT_EXPIRED', 'CREDIT_REVERSED', 'MANUAL_CREDIT', 'MANUAL_DEBIT');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopName" TEXT,
    "contactEmail" TEXT,
    "primaryCurrencyCode" VARCHAR(3),
    "timezone" TEXT,
    "status" "MerchantStatus" NOT NULL DEFAULT 'ACTIVE',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" TEXT NOT NULL DEFAULT 'ORDER_FULFILLED',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "rewardType" TEXT NOT NULL,
    "rewardBase" TEXT NOT NULL DEFAULT 'ORDER_SUBTOTAL',
    "percentage" DECIMAL(7,2),
    "fixedAmount" DECIMAL(20,6),
    "minimumOrderValue" DECIMAL(20,6),
    "maximumReward" DECIMAL(20,6),
    "productMode" TEXT NOT NULL DEFAULT 'ALL',
    "productIds" TEXT NOT NULL DEFAULT '[]',
    "conditions" JSONB,
    "requirePrepaid" BOOLEAN NOT NULL DEFAULT false,
    "expiryDays" INTEGER,
    "notifyCustomer" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditGrant" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "customerGid" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL,
    "status" "CreditGrantStatus" NOT NULL DEFAULT 'PROCESSING',
    "shopifyAccountGid" TEXT,
    "shopifyTransactionGid" TEXT,
    "errorMessage" TEXT,
    "issuedAt" TIMESTAMP(3),
    "reversedAmount" DECIMAL(20,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLedgerEntry" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "customerGid" TEXT NOT NULL,
    "orderGid" TEXT,
    "creditGrantId" TEXT,
    "transactionType" "CreditTransactionType" NOT NULL,
    "direction" "LedgerDirection" NOT NULL DEFAULT 'CREDIT',
    "amount" DECIMAL(20,6) NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "shopifyTransactionGid" TEXT,
    "expiresAt" TIMESTAMP(3),
    "actorType" TEXT,
    "actorId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "apiVersion" TEXT,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "payloadHash" TEXT,
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerGid" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "templateKey" TEXT NOT NULL,
    "subject" TEXT,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_shop_key" ON "Merchant"("shop");

-- CreateIndex
CREATE INDEX "Merchant_status_createdAt_idx" ON "Merchant"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationRule_shop_enabled_trigger_priority_idx" ON "AutomationRule"("shop", "enabled", "trigger", "priority");

-- CreateIndex
CREATE INDEX "AutomationRule_shop_createdAt_idx" ON "AutomationRule"("shop", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditGrant_eventKey_key" ON "CreditGrant"("eventKey");

-- CreateIndex
CREATE INDEX "CreditGrant_shop_customerGid_createdAt_idx" ON "CreditGrant"("shop", "customerGid", "createdAt");

-- CreateIndex
CREATE INDEX "CreditGrant_shop_status_createdAt_idx" ON "CreditGrant"("shop", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CreditGrant_ruleId_idx" ON "CreditGrant"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditGrant_shop_orderGid_ruleId_key" ON "CreditGrant"("shop", "orderGid", "ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditGrant_shop_shopifyTransactionGid_key" ON "CreditGrant"("shop", "shopifyTransactionGid");

-- CreateIndex
CREATE UNIQUE INDEX "CreditLedgerEntry_eventKey_key" ON "CreditLedgerEntry"("eventKey");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_shop_customerGid_createdAt_idx" ON "CreditLedgerEntry"("shop", "customerGid", "createdAt");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_shop_orderGid_idx" ON "CreditLedgerEntry"("shop", "orderGid");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_shop_transactionType_createdAt_idx" ON "CreditLedgerEntry"("shop", "transactionType", "createdAt");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_creditGrantId_idx" ON "CreditLedgerEntry"("creditGrantId");

-- CreateIndex
CREATE INDEX "WebhookEvent_shop_status_receivedAt_idx" ON "WebhookEvent"("shop", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_nextAttemptAt_idx" ON "WebhookEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_shop_webhookId_key" ON "WebhookEvent"("shop", "webhookId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_shop_customerGid_createdAt_idx" ON "Notification"("shop", "customerGid", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_shop_status_scheduledAt_idx" ON "Notification"("shop", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "AuditLog_shop_createdAt_idx" ON "AuditLog"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_shop_entityType_entityId_idx" ON "AuditLog"("shop", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Merchant"("shop") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditGrant" ADD CONSTRAINT "CreditGrant_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Merchant"("shop") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditGrant" ADD CONSTRAINT "CreditGrant_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Merchant"("shop") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_creditGrantId_fkey" FOREIGN KEY ("creditGrantId") REFERENCES "CreditGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Merchant"("shop") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Merchant"("shop") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Merchant"("shop") ON DELETE CASCADE ON UPDATE CASCADE;
