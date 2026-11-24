function nullableText(value) {
  return value === undefined || value === null ? null : String(value);
}

/**
 * Stores the rule configuration used by a reward grant.
 *
 * This snapshot remains on CreditGrant after an AutomationRule is permanently
 * deleted, so refund reconciliation never depends on a live rule row.
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
