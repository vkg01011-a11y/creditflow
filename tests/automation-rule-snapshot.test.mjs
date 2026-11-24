import test from "node:test";
import assert from "node:assert/strict";

import { createAutomationRuleSnapshot } from "../app/domain/automation-rule-snapshot.mjs";

test("captures the reward rule configuration required for later refund reconciliation", () => {
  const snapshot = createAutomationRuleSnapshot({
    name: "QA cashback",
    description: "Test rule",
    trigger: "ORDER_FULFILLED",
    priority: 10,
    rewardType: "PERCENTAGE",
    rewardBase: "ELIGIBLE_ITEMS",
    percentage: { toString: () => "2.50" },
    fixedAmount: null,
    minimumOrderValue: "500",
    maximumReward: "100",
    productMode: "INCLUDE",
    productIds: "[\"1001\",\"1002\"]",
    conditions: { version: 1, logic: "AND", rules: [] },
    requirePrepaid: true,
    expiryDays: 90,
    notifyCustomer: false,
  });

  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.name, "QA cashback");
  assert.equal(snapshot.rewardBase, "ELIGIBLE_ITEMS");
  assert.equal(snapshot.productMode, "INCLUDE");
  assert.equal(snapshot.productIds, "[\"1001\",\"1002\"]");
  assert.equal(snapshot.percentage, "2.50");
  assert.equal(snapshot.notifyCustomer, false);
});

test("normalizes missing optional rule values without retaining undefined fields", () => {
  const snapshot = createAutomationRuleSnapshot({
    name: "All products",
    trigger: "ORDER_FULFILLED",
    priority: 100,
    rewardType: "FIXED",
    rewardBase: "ORDER_SUBTOTAL",
    productMode: "ALL",
    productIds: null,
    requirePrepaid: false,
    notifyCustomer: true,
  });

  assert.equal(snapshot.percentage, null);
  assert.equal(snapshot.fixedAmount, null);
  assert.equal(snapshot.productIds, "[]");
  assert.equal(snapshot.expiryDays, null);
  assert.equal("undefined" in snapshot, false);
});
