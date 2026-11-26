export type MeteredPlan = "starter" | "growth" | "professional";

export type BillingPolicyStatus = {
  configured: boolean;
  active: boolean;
  plan: MeteredPlan | "business" | "none" | "unknown";
  isTrial: boolean;
  shopGid: string | null;
  cycleStart: string | null;
  cycleEnd: string | null;
};

export const BILLING_REVIEW_MESSAGES: Readonly<{
  STATUS_UNVERIFIED: string;
  PLAN_CHANGED: string;
  CYCLE_UNAVAILABLE: string;
  OCCURRENCE_OUTSIDE_CYCLE: string;
  DELIVERY_UNCERTAIN: string;
  TEMPORARY_FAILURE: string;
  PLAN_UNSUPPORTED: string;
}>;

export function buildBillingUsageIdempotencyKey(shop: string, orderGid: string): string;

export function isActiveBillingTrial(trialEndsAt: string | null | undefined): boolean;

export function getBillingReviewMessage(reason: string): string;

export function buildUnverifiedBillingUsageReservation(input: {
  shop: string;
  orderGid: string;
  occurredAt: Date;
  reason?: string;
}): {
  shop: string;
  orderGid: string;
  planAtOccurrence: "UNVERIFIED";
  idempotencyKey: string;
  occurredAt: Date;
  status: "REVIEW_REQUIRED";
  lastError: string;
};

export type BillingUsageEligibility =
  | { kind: "QUEUE"; plan: MeteredPlan }
  | { kind: "NOT_BILLABLE"; reason: "NO_ACTIVE_PLAN" | "TRIAL" | "UNLIMITED_PLAN" }
  | { kind: "REVIEW_REQUIRED"; reason: "STATUS_UNVERIFIED" | "PLAN_UNSUPPORTED" | "CYCLE_UNAVAILABLE" | "OCCURRENCE_OUTSIDE_CYCLE" | "PLAN_CHANGED" };

export function classifyUsageAtOccurrence(input: {
  status: BillingPolicyStatus;
  occurredAt: Date | string;
  now?: number | Date | string;
}): BillingUsageEligibility;

export type BillingUsageDeliveryEvaluation =
  | { kind: "SEND"; shopGid: string; timestamp: string }
  | Exclude<BillingUsageEligibility, { kind: "QUEUE" }>;

export function evaluateUsageEventDelivery(input: {
  status: BillingPolicyStatus;
  planAtOccurrence: string;
  occurredAt: Date | string;
  now?: number | Date | string;
}): BillingUsageDeliveryEvaluation;
