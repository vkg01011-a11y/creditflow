import {
  calculateEligibleLineSubtotal,
  calculateReward,
  evaluateRuleConditions,
} from "./reward-engine.mjs";

/**
 * Pure, read-only rule simulation. This function intentionally previews
 * paused rules by evaluating their configuration as enabled; it never writes
 * to Shopify or to the database.
 */
export function simulateAutomationRule({ rule, sample }) {
  const currencyCode = String(sample.currencyCode || "").toUpperCase();
  const orderSubtotal = String(sample.orderSubtotal ?? "0");
  const lineItems = sample.lineItems ?? [];

  let productIds = [];
  try {
    const parsed = JSON.parse(rule.productIds || "[]");
    productIds = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    throw new Error("The saved rule contains invalid product targeting data.");
  }

  const order = {
    line_items: lineItems,
    tags: Array.isArray(sample.orderTags) ? sample.orderTags.join(", ") : "",
    discount_codes: (sample.discountCodes ?? []).map((code) => ({ code })),
    shipping_address: sample.shippingCountry
      ? { country_code: sample.shippingCountry }
      : null,
  };

  const conditionEvaluation = evaluateRuleConditions({
    order,
    conditions: rule.conditions,
    orderSubtotal,
    currencyCode,
    paymentStatus: sample.paymentStatus ?? "UNKNOWN",
    customer: sample.customer ?? null,
  });

  const eligibleSubtotal = calculateEligibleLineSubtotal(
    lineItems,
    { productMode: rule.productMode, productIds },
    currencyCode,
  );

  // The simulator previews configuration independently of activation state.
  // The original state is returned separately and is never modified.
  const calculation = calculateReward({
    orderSubtotal,
    eligibleSubtotal,
    currencyCode,
    paymentStatus: sample.paymentStatus ?? "UNKNOWN",
    rule: {
      enabled: true,
      requirePrepaid: rule.requirePrepaid,
      minimumOrderValue: rule.minimumOrderValue == null
        ? null
        : String(rule.minimumOrderValue),
      rewardBase: rule.rewardBase,
      rewardType: rule.rewardType,
      fixedAmount: rule.fixedAmount == null ? undefined : String(rule.fixedAmount),
      percentage: rule.percentage == null ? undefined : String(rule.percentage),
      maximumReward: rule.maximumReward == null ? null : String(rule.maximumReward),
      productMode: rule.productMode,
      productIds,
    },
  });

  const eligible = conditionEvaluation.matches && calculation.eligible;
  const rewardBaseAmount = rule.rewardBase === "ELIGIBLE_ITEMS"
    ? eligibleSubtotal
    : orderSubtotal;

  return {
    rule: {
      id: rule.id,
      name: rule.name,
      enabled: Boolean(rule.enabled),
      archived: Boolean(rule.archivedAt),
    },
    eligible,
    reason: !conditionEvaluation.matches
      ? "CONDITIONS_NOT_MET"
      : calculation.reason,
    conditions: conditionEvaluation,
    calculation: {
      currencyCode,
      orderSubtotal,
      eligibleSubtotal,
      rewardBase: rule.rewardBase,
      rewardBaseAmount,
      estimatedReward: eligible ? calculation.amount : "0",
      maximumReward: rule.maximumReward == null
        ? null
        : String(rule.maximumReward),
    },
    previewOnly: true,
  };
}
