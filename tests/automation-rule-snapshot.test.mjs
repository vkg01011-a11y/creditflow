import test from "node:test";
import assert from "node:assert/strict";

import {
  createAutomationRuleSnapshot,
  resolveRefundRuleConfiguration,
} from "../app/domain/automation-rule-snapshot.mjs";

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
});

test("refund reconciliation uses the immutable snapshot after its rule is deleted", () => {
  const snapshot = createAutomationRuleSnapshot({
    name: "Original selective cashback",
    trigger: "ORDER_FULFILLED",
    priority: 5,
    rewardType: "PERCENTAGE",
    rewardBase: "ELIGIBLE_ITEMS",
    percentage: "5.00",
    productMode: "INCLUDE",
    productIds: "[\"101\",\"202\"]",
    requirePrepaid: false,
    notifyCustomer: false,
  });

  const result = resolveRefundRuleConfiguration({
    ruleSnapshot: snapshot,
    rule: null,
  });

  assert.deepEqual(result, {
    rewardBase: "ELIGIBLE_ITEMS",
    productMode: "INCLUDE",
    productIds: "[\"101\",\"202\"]",
  });
});

test("refund reconciliation prefers the grant snapshot over a subsequently edited live rule", () => {
  const snapshot = createAutomationRuleSnapshot({
    name: "Original rule",
    trigger: "ORDER_FULFILLED",
    priority: 5,
    rewardType: "PERCENTAGE",
    rewardBase: "ELIGIBLE_ITEMS",
    percentage: "5.00",
    productMode: "INCLUDE",
    productIds: "[\"101\"]",
    requirePrepaid: false,
    notifyCustomer: false,
  });

  const result = resolveRefundRuleConfiguration({
    ruleSnapshot: snapshot,
    rule: {
      rewardBase: "ORDER_SUBTOTAL",
      productMode: "EXCLUDE",
      productIds: "[\"999\"]",
    },
  });

  assert.deepEqual(result, {
    rewardBase: "ELIGIBLE_ITEMS",
    productMode: "INCLUDE",
    productIds: "[\"101\"]",
  });
});

test("refund reconciliation fails closed when neither a snapshot nor a rule exists", () => {
  assert.throws(
    () => resolveRefundRuleConfiguration({ ruleSnapshot: null, rule: null }),
    /no preserved reward-rule configuration/,
  );
});
