import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAutomationExecutionKey,
  classifyAutomationExecution,
} from "../app/domain/automation-execution.mjs";

test("execution keys are deterministic and separate rule identifiers", () => {
  const key = buildAutomationExecutionKey("store.myshopify.com", "gid://shopify/Order/1", "rule-a");
  assert.equal(key, buildAutomationExecutionKey("store.myshopify.com", "gid://shopify/Order/1", "rule-a"));
  assert.notEqual(key, buildAutomationExecutionKey("store.myshopify.com", "gid://shopify/Order/1", "rule-b"));
  assert.equal(key, "fulfilled:store.myshopify.com:gid://shopify/Order/1:rule-a");
});

test("condition mismatch is distinguished from reward ineligibility", () => {
  assert.deepEqual(
    classifyAutomationExecution({ conditionEvaluation: { matches: false }, calculation: null }),
    { status: "CONDITION_MISMATCH", reason: "CONDITIONS_NOT_MET" },
  );
  assert.deepEqual(
    classifyAutomationExecution({
      conditionEvaluation: { matches: true },
      calculation: { eligible: false, reason: "MINIMUM_ORDER_VALUE_NOT_MET" },
    }),
    { status: "NOT_ELIGIBLE", reason: "MINIMUM_ORDER_VALUE_NOT_MET" },
  );
});

test("eligible calculations remain processing until the credit grant is confirmed", () => {
  assert.deepEqual(
    classifyAutomationExecution({
      conditionEvaluation: { matches: true },
      calculation: { eligible: true, amount: "25.00" },
    }),
    { status: "PROCESSING", reason: "REWARD_ELIGIBLE" },
  );
});

test("execution keys reject missing shop or order identifiers", () => {
  assert.throws(() => buildAutomationExecutionKey("", "order", "rule"));
  assert.throws(() => buildAutomationExecutionKey("shop", "", "rule"));
});

test("no-active-rule keys use a distinct deterministic namespace", () => {
  assert.equal(
    buildAutomationExecutionKey("store.myshopify.com", "gid://shopify/Order/1", null),
    "automation-execution:store.myshopify.com:gid://shopify/Order/1:NO_ACTIVE_RULES",
  );
});
