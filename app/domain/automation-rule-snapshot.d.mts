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
}): Record<string, unknown>;
