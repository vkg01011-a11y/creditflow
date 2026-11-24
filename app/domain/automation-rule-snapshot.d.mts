export type AutomationRuleSnapshot = {
  version: 1;
  name: string;
  description: string | null;
  trigger: string;
  priority: number;
  rewardType: string;
  rewardBase: string;
  percentage: string | null;
  fixedAmount: string | null;
  minimumOrderValue: string | null;
  maximumReward: string | null;
  productMode: string;
  productIds: string;
  conditions: unknown;
  requirePrepaid: boolean;
  expiryDays: number | null;
  notifyCustomer: boolean;
};

export function createAutomationRuleSnapshot(rule: {
  name: string;
  description?: string | null;
  trigger: string;
  priority: number;
  rewardType: string;
  rewardBase: string;
  percentage?: { toString(): string } | string | number | null;
  fixedAmount?: { toString(): string } | string | number | null;
  minimumOrderValue?: { toString(): string } | string | number | null;
  maximumReward?: { toString(): string } | string | number | null;
  productMode: string;
  productIds?: string | null;
  conditions?: unknown;
  requirePrepaid: boolean;
  expiryDays?: number | null;
  notifyCustomer: boolean;
}): AutomationRuleSnapshot;

export function resolveRefundRuleConfiguration(input: {
  ruleSnapshot?: unknown;
  rule?: unknown;
}): {
  rewardBase: string;
  productMode: string;
  productIds: string;
};
