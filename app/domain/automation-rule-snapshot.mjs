function nullableText(value) {
  return value === undefined || value === null ? null : String(value);
}

/**
 * Stores the rule configuration used by a reward grant.
 *
 * The snapshot remains after the AutomationRule is permanently deleted.
 * Refund reconciliation prefers this immutable snapshot over the live rule.
 */
export function createAutomationRuleSnapshot(rule) {
  return {
    version: 1,
    name: String(rule.name),
    description: rule.description ?? null,
    trigger: String(rule.trigger),
    priority: Number(rule.priority),
    rewardType: String(rule.rewardType),
    rewardBase: String(rule.rewardBase),
    percentage: nullableText(rule.percentage),
    fixedAmount: nullableText(rule.fixedAmount),
    minimumOrderValue: nullableText(rule.minimumOrderValue),
    maximumReward: nullableText(rule.maximumReward),
    productMode: String(rule.productMode),
    productIds: String(rule.productIds ?? "[]"),
    conditions: rule.conditions ?? null,
    requirePrepaid: Boolean(rule.requirePrepaid),
    expiryDays: rule.expiryDays ?? null,
    notifyCustomer: Boolean(rule.notifyCustomer),
  };
}

/**
 * Resolve the immutable rule settings used to calculate a refund basis.
 *
 * Legacy grants can fall back to their still-linked rule when no snapshot is
 * available. New grants and migrated historical grants should always use the
 * snapshot, preventing later rule edits from changing prior refund math.
 */
export function resolveRefundRuleConfiguration({ ruleSnapshot, rule }) {
  const snapshotIsRecord =
    typeof ruleSnapshot === "object" &&
    ruleSnapshot !== null &&
    !Array.isArray(ruleSnapshot);

  const source = snapshotIsRecord ? ruleSnapshot : rule;

  if (
    typeof source !== "object" ||
    source === null ||
    Array.isArray(source)
  ) {
    throw new Error(
      "The grant has no preserved reward-rule configuration. Review it manually.",
    );
  }

  const rewardBase = String(source.rewardBase ?? "");
  const productMode = String(source.productMode ?? "");
  const productIds = String(source.productIds ?? "[]");

  if (!["ORDER_SUBTOTAL", "ELIGIBLE_ITEMS"].includes(rewardBase)) {
    throw new Error("The stored reward rule has an unsupported reward base.");
  }

  if (!["ALL", "INCLUDE", "EXCLUDE"].includes(productMode)) {
    throw new Error("The stored reward rule has an unsupported product mode.");
  }

  return { rewardBase, productMode, productIds };
}
