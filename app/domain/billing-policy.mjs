import { createHash } from "node:crypto";

const METERED_PLANS = new Set(["starter", "growth", "professional"]);
const MAX_FUTURE_EVENT_SKEW_MS = 5 * 60 * 1000;

export const BILLING_REVIEW_MESSAGES = Object.freeze({
  STATUS_UNVERIFIED:
    "CreditFlow could not verify this order's plan when it was evaluated. No usage event was sent. Review the Shopify subscription before reconciling.",
  PLAN_CHANGED:
    "The subscription changed before this usage event was sent. No event was submitted. Review the subscription and billing cycle before reconciling.",
  CYCLE_UNAVAILABLE:
    "Shopify did not return a usable billing cycle for this order. No usage event was submitted. Review the App Billing Event log before reconciling.",
  OCCURRENCE_OUTSIDE_CYCLE:
    "This order timestamp is outside the current billing cycle. No usage event was submitted. Review the App Billing Event log before reconciling.",
  DELIVERY_UNCERTAIN:
    "Shopify did not confirm this usage event after retries. Check the App Billing Event log before any further action.",
  TEMPORARY_FAILURE:
    "Shopify could not confirm the usage event. CreditFlow will retry with the same idempotency key.",
  PLAN_UNSUPPORTED:
    "Shopify returned a plan that CreditFlow does not recognize. No usage event was submitted. Contact CreditFlow support before reconciling.",
});

const REVIEW_MESSAGE_BY_REASON = Object.freeze({
  STATUS_UNVERIFIED: BILLING_REVIEW_MESSAGES.STATUS_UNVERIFIED,
  PLAN_CHANGED: BILLING_REVIEW_MESSAGES.PLAN_CHANGED,
  CYCLE_UNAVAILABLE: BILLING_REVIEW_MESSAGES.CYCLE_UNAVAILABLE,
  OCCURRENCE_OUTSIDE_CYCLE: BILLING_REVIEW_MESSAGES.OCCURRENCE_OUTSIDE_CYCLE,
  PLAN_UNSUPPORTED: BILLING_REVIEW_MESSAGES.PLAN_UNSUPPORTED,
});

export function getBillingReviewMessage(reason) {
  return REVIEW_MESSAGE_BY_REASON[reason] ?? BILLING_REVIEW_MESSAGES.DELIVERY_UNCERTAIN;
}

export function buildBillingUsageIdempotencyKey(shop, orderGid) {
  return createHash("sha256")
    .update(`creditflow:orders_processed:${shop}:${orderGid}`)
    .digest("hex");
}

export function isActiveBillingTrial(trialEndsAt) {
  return typeof trialEndsAt === "string" && trialEndsAt.trim().length > 0;
}

export function buildUnverifiedBillingUsageReservation({
  shop,
  orderGid,
  occurredAt,
  reason = "STATUS_UNVERIFIED",
}) {
  return {
    shop,
    orderGid,
    planAtOccurrence: "UNVERIFIED",
    idempotencyKey: buildBillingUsageIdempotencyKey(shop, orderGid),
    occurredAt,
    status: "REVIEW_REQUIRED",
    lastError: getBillingReviewMessage(reason),
  };
}

function toTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value);
  return Number.NaN;
}

function getCycle(status) {
  const start = typeof status.cycleStart === "string"
    ? Date.parse(status.cycleStart)
    : Number.NaN;
  const end = typeof status.cycleEnd === "string"
    ? Date.parse(status.cycleEnd)
    : Number.NaN;

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }

  return { start, end };
}

function review(reason) {
  return { kind: "REVIEW_REQUIRED", reason };
}

export function classifyUsageAtOccurrence({ status, occurredAt, now = Date.now() }) {
  if (!status.configured) return review("STATUS_UNVERIFIED");
  if (!status.active) return { kind: "NOT_BILLABLE", reason: "NO_ACTIVE_PLAN" };
  if (status.isTrial) return { kind: "NOT_BILLABLE", reason: "TRIAL" };
  if (status.plan === "business") {
    return { kind: "NOT_BILLABLE", reason: "UNLIMITED_PLAN" };
  }
  if (!METERED_PLANS.has(status.plan)) return review("PLAN_UNSUPPORTED");
  if (!status.shopGid) return review("STATUS_UNVERIFIED");

  const cycle = getCycle(status);
  if (!cycle) return review("CYCLE_UNAVAILABLE");

  const occurredAtMs = toTimestamp(occurredAt);
  const nowMs = toTimestamp(now);
  if (!Number.isFinite(occurredAtMs) || !Number.isFinite(nowMs)) {
    return review("OCCURRENCE_OUTSIDE_CYCLE");
  }
  if (occurredAtMs > nowMs + MAX_FUTURE_EVENT_SKEW_MS) {
    return review("OCCURRENCE_OUTSIDE_CYCLE");
  }
  if (occurredAtMs < cycle.start || occurredAtMs >= cycle.end) {
    return review("OCCURRENCE_OUTSIDE_CYCLE");
  }

  return { kind: "QUEUE", plan: status.plan };
}

export function evaluateUsageEventDelivery({
  status,
  planAtOccurrence,
  occurredAt,
  now = Date.now(),
}) {
  const eligibility = classifyUsageAtOccurrence({ status, occurredAt, now });

  if (eligibility.kind === "NOT_BILLABLE") {
    return review("PLAN_CHANGED");
  }
  if (eligibility.kind === "REVIEW_REQUIRED") return eligibility;
  if (eligibility.plan !== planAtOccurrence) return review("PLAN_CHANGED");

  return {
    kind: "SEND",
    shopGid: status.shopGid,
    timestamp: new Date(toTimestamp(occurredAt)).toISOString(),
  };
}
