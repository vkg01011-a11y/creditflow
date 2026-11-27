import test from "node:test";
import assert from "node:assert/strict";

import {
  BILLING_REVIEW_MESSAGES,
  buildBillingUsageIdempotencyKey,
  buildUnverifiedBillingUsageReservation,
  classifyUsageAtOccurrence,
  evaluateUsageEventDelivery,
  getBillingReviewMessage,
  isActiveBillingTrial,
} from "../app/domain/billing-policy.mjs";

const cycleStart = "2026-11-01T00:00:00.000Z";
const cycleEnd = "2026-12-01T00:00:00.000Z";
const occurredAt = new Date("2026-11-24T12:00:00.000Z");
const now = Date.parse("2026-11-25T12:00:00.000Z");

function status(overrides = {}) {
  return {
    configured: true,
    active: true,
    plan: "growth",
    isTrial: false,
    shopGid: "gid://shopify/Shop/1",
    cycleStart,
    cycleEnd,
    ...overrides,
  };
}

test("reserves a stable 64-character idempotency key for an unverified order", () => {
  const first = buildBillingUsageIdempotencyKey("store.myshopify.com", "gid://shopify/Order/1");
  const second = buildBillingUsageIdempotencyKey("store.myshopify.com", "gid://shopify/Order/1");
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);

  const reservation = buildUnverifiedBillingUsageReservation({
    shop: "store.myshopify.com",
    orderGid: "gid://shopify/Order/1",
    occurredAt,
  });
  assert.equal(reservation.planAtOccurrence, "UNVERIFIED");
  assert.equal(reservation.status, "REVIEW_REQUIRED");
  assert.equal(reservation.idempotencyKey, first);
  assert.match(reservation.lastError, /No usage event was sent/);
});

test("treats Shopify trial metadata, not missing cycle dates, as trial authority", () => {
  assert.equal(isActiveBillingTrial("2026-12-01T00:00:00.000Z"), true);
  assert.equal(isActiveBillingTrial(""), false);
  assert.equal(isActiveBillingTrial(null), false);
  assert.deepEqual(
    classifyUsageAtOccurrence({ status: status({ cycleStart: null }), occurredAt, now }),
    { kind: "REVIEW_REQUIRED", reason: "CYCLE_UNAVAILABLE" },
  );
});

test("queues eligible metered usage inside the active cycle", () => {
  assert.deepEqual(
    classifyUsageAtOccurrence({ status: status(), occurredAt, now }),
    { kind: "QUEUE", plan: "growth" },
  );
});

test("does not queue usage without a verified subscription or for non-metered orders", () => {
  assert.deepEqual(
    classifyUsageAtOccurrence({ status: status({ configured: false }), occurredAt, now }),
    { kind: "REVIEW_REQUIRED", reason: "STATUS_UNVERIFIED" },
  );
  assert.deepEqual(
    classifyUsageAtOccurrence({ status: status({ active: false, plan: "none" }), occurredAt, now }),
    { kind: "NOT_BILLABLE", reason: "NO_ACTIVE_PLAN" },
  );
  assert.deepEqual(
    classifyUsageAtOccurrence({ status: status({ isTrial: true }), occurredAt, now }),
    { kind: "NOT_BILLABLE", reason: "TRIAL" },
  );
  assert.deepEqual(
    classifyUsageAtOccurrence({ status: status({ plan: "business" }), occurredAt, now }),
    { kind: "NOT_BILLABLE", reason: "UNLIMITED_PLAN" },
  );
  assert.deepEqual(
    classifyUsageAtOccurrence({ status: status({ plan: "unknown" }), occurredAt, now }),
    { kind: "REVIEW_REQUIRED", reason: "PLAN_UNSUPPORTED" },
  );
});

test("requires a valid half-open cycle and rejects future order timestamps", () => {
  assert.deepEqual(
    classifyUsageAtOccurrence({ status: status({ cycleEnd: cycleStart }), occurredAt, now }),
    { kind: "REVIEW_REQUIRED", reason: "CYCLE_UNAVAILABLE" },
  );
  assert.deepEqual(
    classifyUsageAtOccurrence({ status: status(), occurredAt: new Date(cycleEnd), now }),
    { kind: "REVIEW_REQUIRED", reason: "OCCURRENCE_OUTSIDE_CYCLE" },
  );
  assert.deepEqual(
    classifyUsageAtOccurrence({ status: status(), occurredAt: new Date(now + 6 * 60_000), now }),
    { kind: "REVIEW_REQUIRED", reason: "OCCURRENCE_OUTSIDE_CYCLE" },
  );
});

test("sends only when the captured plan still matches a verified billable plan", () => {
  assert.deepEqual(
    evaluateUsageEventDelivery({ status: status(), planAtOccurrence: "growth", occurredAt, now }),
    { kind: "SEND", shopGid: "gid://shopify/Shop/1", timestamp: occurredAt.toISOString() },
  );
  for (const changedStatus of [
    status({ plan: "professional" }),
    status({ active: false, plan: "none" }),
    status({ isTrial: true }),
    status({ plan: "business" }),
  ]) {
    assert.deepEqual(
      evaluateUsageEventDelivery({ status: changedStatus, planAtOccurrence: "growth", occurredAt, now }),
      { kind: "REVIEW_REQUIRED", reason: "PLAN_CHANGED" },
    );
  }
  assert.deepEqual(
    evaluateUsageEventDelivery({ status: status(), planAtOccurrence: "UNVERIFIED", occurredAt, now }),
    { kind: "REVIEW_REQUIRED", reason: "PLAN_CHANGED" },
  );
});

test("maps operator-facing review messages without exposing remote error details", () => {
  assert.equal(
    getBillingReviewMessage("STATUS_UNVERIFIED"),
    BILLING_REVIEW_MESSAGES.STATUS_UNVERIFIED,
  );
  assert.equal(
    getBillingReviewMessage("remote error containing sensitive data"),
    BILLING_REVIEW_MESSAGES.DELIVERY_UNCERTAIN,
  );
});
