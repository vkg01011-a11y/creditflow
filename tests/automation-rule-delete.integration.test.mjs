import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

import { createAutomationRuleSnapshot } from "../app/domain/automation-rule-snapshot.mjs";
import { buildAutomationExecutionKey } from "../app/domain/automation-execution.mjs";

const runDatabaseIntegrationTests =
  process.env.CREDITFLOW_RUN_DB_TESTS === "1";

test("deleting a paused automation removes only its definition and preserves financial history", {
  skip: !runDatabaseIntegrationTests,
}, async () => {
  const db = new PrismaClient();
  const suffix = randomUUID().replaceAll("-", "");
  const shop = `delete-test-${suffix}.myshopify.com`;
  const customerGid = `gid://shopify/Customer/${suffix}`;
  const orderGid = `gid://shopify/Order/${suffix}`;
  const shopifyCreditTransactionGid =
    `gid://shopify/StoreCreditAccountTransaction/${suffix}`;

  try {
    await db.merchant.create({ data: { shop } });

    const rule = await db.automationRule.create({
      data: {
        shop,
        name: "Integration delete test",
        rewardType: "PERCENTAGE",
        rewardBase: "ELIGIBLE_ITEMS",
        percentage: "5.00",
        productMode: "INCLUDE",
        productIds: "[\"101\"]",
        enabled: false,
        notifyCustomer: false,
      },
    });

    const snapshot = createAutomationRuleSnapshot(rule);

    const grant = await db.creditGrant.create({
      data: {
        shop,
        eventKey: `fulfilled:${shop}:${orderGid}:${rule.id}`,
        customerGid,
        orderGid,
        ruleId: rule.id,
        ruleNameSnapshot: rule.name,
        ruleSnapshot: snapshot,
        amount: "5.00",
        currencyCode: "INR",
        rewardBaseAmount: "100.00",
        status: "ISSUED",
        shopifyTransactionGid: shopifyCreditTransactionGid,
        issuedAt: new Date(),
      },
    });

    const ledger = await db.creditLedgerEntry.create({
      data: {
        shop,
        eventKey: `credit:${suffix}`,
        customerGid,
        orderGid,
        creditGrantId: grant.id,
        transactionType: "CASHBACK_CREDIT",
        direction: "CREDIT",
        amount: "5.00",
        currencyCode: "INR",
        reason: "Integration test credit",
        shopifyTransactionGid: shopifyCreditTransactionGid,
      },
    });

    const executionKey = buildAutomationExecutionKey(shop, orderGid, rule.id);
    assert.equal(executionKey, grant.eventKey);
    const execution = await db.automationExecution.create({
      data: {
        shop,
        executionKey,
        orderGid,
        orderName: "#DELETE-TEST",
        ruleId: rule.id,
        ruleNameSnapshot: rule.name,
        rulePrioritySnapshot: rule.priority,
        trigger: "ORDER_FULFILLED",
        status: "ISSUED",
        reason: "REWARD_ISSUED",
        conditions: { version: 1, logic: "AND", rules: [] },
        orderSubtotal: "100.00",
        eligibleSubtotal: "100.00",
        rewardBase: "ELIGIBLE_ITEMS",
        rewardBaseAmount: "100.00",
        estimatedReward: "5.00",
        currencyCode: "INR",
        creditGrantId: grant.id,
        grantAmount: "5.00",
        completedAt: new Date(),
      },
    });

    const reversal = await db.creditReversal.create({
      data: {
        shop,
        refundGid: `gid://shopify/Refund/${suffix}`,
        webhookId: `refund-webhook-${suffix}`,
        orderGid,
        creditGrantId: grant.id,
        refundedBaseAmount: "25.00",
        amount: "1.25",
        currencyCode: "INR",
        status: "REVERSED",
        shopifyTransactionGid:
          `gid://shopify/StoreCreditAccountTransaction/reversal-${suffix}`,
        processedAt: new Date(),
      },
    });

    // Mirror the server's transaction: snapshot any grant missing one, then
    // hard-delete the rule. PostgreSQL's ON DELETE SET NULL must retain grants.
    await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw`
        SELECT "id", "enabled"
        FROM "AutomationRule"
        WHERE "id" = ${rule.id} AND "shop" = ${shop}
        FOR UPDATE
      `;

      assert.equal(locked.length, 1);
      assert.equal(locked[0].enabled, false);

      await tx.$executeRaw`
        UPDATE "CreditGrant"
        SET "ruleNameSnapshot" = ${rule.name},
            "ruleSnapshot" = ${JSON.stringify(snapshot)}::jsonb
        WHERE "shop" = ${shop}
          AND "ruleId" = ${rule.id}
          AND "ruleSnapshot" IS NULL
      `;

      await tx.automationRule.delete({ where: { id: rule.id } });
    });

    const [deletedRule, preservedGrant, preservedLedger, preservedReversal, preservedExecution] =
      await Promise.all([
        db.automationRule.findFirst({ where: { id: rule.id, shop } }),
        db.creditGrant.findUnique({ where: { id: grant.id } }),
        db.creditLedgerEntry.findUnique({ where: { id: ledger.id } }),
        db.creditReversal.findUnique({ where: { id: reversal.id } }),
        db.automationExecution.findUnique({ where: { id: execution.id } }),
      ]);

    assert.equal(deletedRule, null);
    assert.ok(preservedGrant);
    assert.equal(preservedGrant.ruleId, null);
    assert.equal(preservedGrant.ruleNameSnapshot, rule.name);
    assert.equal(preservedGrant.ruleSnapshot.rewardBase, "ELIGIBLE_ITEMS");
    assert.equal(preservedGrant.shopifyTransactionGid, shopifyCreditTransactionGid);
    assert.equal(preservedLedger?.creditGrantId, grant.id);
    assert.equal(preservedReversal?.creditGrantId, grant.id);
    assert.ok(preservedExecution);
    assert.equal(preservedExecution.ruleId, rule.id);
    assert.equal(preservedExecution.ruleNameSnapshot, rule.name);
    assert.equal(preservedExecution.creditGrantId, grant.id);
    assert.equal(preservedExecution.grantAmount.toString(), "5");
  } finally {
    await db.merchant.deleteMany({ where: { shop } });
    await db.$disconnect();
  }
});
