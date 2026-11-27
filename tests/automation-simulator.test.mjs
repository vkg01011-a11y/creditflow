import test from "node:test";
import assert from "node:assert/strict";
import { simulateAutomationRule } from "../app/domain/automation-simulator.mjs";

const baseRule = {
  id: "rule_test",
  name: "Prepaid cashback",
  enabled: false,
  archivedAt: null,
  rewardType: "PERCENTAGE",
  rewardBase: "ORDER_SUBTOTAL",
  percentage: "5",
  fixedAmount: null,
  minimumOrderValue: "1000",
  maximumReward: "500",
  productMode: "ALL",
  productIds: "[]",
  requirePrepaid: true,
  conditions: {
    version: 1,
    logic: "AND",
    rules: [
      { field: "ORDER_SUBTOTAL", operator: "GREATER_THAN_OR_EQUAL", value: "1000" },
      { field: "PAYMENT_STATUS", operator: "EQUALS", value: "PREPAID" },
    ],
  },
};

const baseSample = {
  currencyCode: "INR",
  orderSubtotal: "10000",
  paymentStatus: "PREPAID",
  lineItems: [
    { product_id: "101", quantity: 1, price: "10000", total_discount: "0" },
  ],
  orderTags: [],
  discountCodes: [],
  shippingCountry: "IN",
  customer: { tags: ["vip"], numberOfOrders: "3" },
};

test("previews a paused rule without changing its activation state", () => {
  const result = simulateAutomationRule({ rule: baseRule, sample: baseSample });
  assert.equal(result.eligible, true);
  assert.equal(result.calculation.estimatedReward, "500.00");
  assert.equal(result.rule.enabled, false);
  assert.equal(result.previewOnly, true);
});

test("returns individual AND condition results when a condition fails", () => {
  const result = simulateAutomationRule({
    rule: baseRule,
    sample: { ...baseSample, paymentStatus: "COD" },
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "CONDITIONS_NOT_MET");
  assert.deepEqual(result.conditions.results.map((item) => item.passed), [true, false]);
  assert.equal(result.calculation.estimatedReward, "0");
});

test("respects prepaid requirement even when there are no extra conditions", () => {
  const rule = { ...baseRule, conditions: { version: 1, logic: "AND", rules: [] } };
  const result = simulateAutomationRule({
    rule,
    sample: { ...baseSample, paymentStatus: "COD" },
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "PREPAID_PAYMENT_REQUIRED");
});

test("uses eligible product subtotal after discounts for ELIGIBLE_ITEMS", () => {
  const rule = {
    ...baseRule,
    rewardBase: "ELIGIBLE_ITEMS",
    productMode: "INCLUDE",
    productIds: "[\"101\"]",
    conditions: { version: 1, logic: "AND", rules: [] },
  };
  const result = simulateAutomationRule({
    rule,
    sample: {
      ...baseSample,
      lineItems: [
        { product_id: "101", quantity: 2, price: "1000", total_discount: "200" },
        { product_id: "202", quantity: 1, price: "5000", total_discount: "0" },
      ],
    },
  });
  assert.equal(result.calculation.eligibleSubtotal, "1800.00");
  assert.equal(result.calculation.rewardBaseAmount, "1800.00");
  assert.equal(result.calculation.estimatedReward, "90.00");
});

test("does not award an estimated amount when the minimum order value fails", () => {
  const rule = { ...baseRule, conditions: { version: 1, logic: "AND", rules: [] } };
  const result = simulateAutomationRule({
    rule,
    sample: { ...baseSample, orderSubtotal: "500" },
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "MINIMUM_ORDER_VALUE_NOT_MET");
  assert.equal(result.calculation.estimatedReward, "0");
});

test("respects the maximum reward cap", () => {
  const rule = { ...baseRule, maximumReward: "100" };
  const result = simulateAutomationRule({ rule, sample: baseSample });
  assert.equal(result.eligible, true);
  assert.equal(result.calculation.estimatedReward, "100.00");
});

test("evaluates product exclusion targeting in preview", () => {
  const rule = {
    ...baseRule,
    rewardBase: "ELIGIBLE_ITEMS",
    productMode: "EXCLUDE",
    productIds: "[\"101\"]",
    conditions: { version: 1, logic: "AND", rules: [] },
  };
  const result = simulateAutomationRule({
    rule,
    sample: {
      ...baseSample,
      lineItems: [
        { product_id: "101", quantity: 1, price: "1000", total_discount: "0" },
        { product_id: "202", quantity: 1, price: "5000", total_discount: "0" },
      ],
    },
  });
  assert.equal(result.calculation.eligibleSubtotal, "5000.00");
  assert.equal(result.calculation.estimatedReward, "250.00");
});
