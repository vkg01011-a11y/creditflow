
export type RewardConditionField =
  | "ORDER_SUBTOTAL"
  | "ITEM_QUANTITY"
  | "PAYMENT_STATUS"
  | "ORDER_TAG"
  | "DISCOUNT_CODE"
  | "SHIPPING_COUNTRY"
  | "CUSTOMER_TAG"
  | "CUSTOMER_ORDER_COUNT";

export type RewardConditionOperator =
  | "EQUALS"
  | "NOT_EQUALS"
  | "GREATER_THAN"
  | "GREATER_THAN_OR_EQUAL"
  | "LESS_THAN"
  | "LESS_THAN_OR_EQUAL"
  | "CONTAINS"
  | "NOT_CONTAINS";

export type RewardCondition = {
  field: RewardConditionField;
  operator: RewardConditionOperator;
  value: string;
};

export type RewardConditionGroup = {
  version?: 1;
  logic: "AND" | "OR";
  rules: RewardCondition[];
};

export type RewardRule = {
  enabled?: boolean;
  requirePrepaid?: boolean;
  minimumOrderValue?: string | null;
  rewardBase?: "ORDER_SUBTOTAL" | "ELIGIBLE_ITEMS";
  rewardType: "FIXED" | "PERCENTAGE";
  fixedAmount?: string;
  percentage?: string;
  maximumReward?: string | null;
  productMode?: "ALL" | "INCLUDE" | "EXCLUDE";
  productIds?: string[];
};

export function matchesRuleConditions(input: {
  order: {
    tags?: string | string[];
    discount_codes?: Array<string | { code?: string }>;
    line_items?: Array<{
      quantity?: number | string;
    }>;
    shipping_address?: {
      country_code?: string;
      country_code_v2?: string;
    } | null;
  };
  conditions?: RewardConditionGroup | null;
  orderSubtotal: string;
  currencyCode: string;
  paymentStatus?: "PREPAID" | "COD" | "UNKNOWN";
  customer?: {
    tags?: string[];
    numberOfOrders?: number | string;
  } | null;
}): boolean;

export function calculateReward(input: {
  orderSubtotal: string;
  eligibleSubtotal?: string;
  currencyCode: string;
  paymentStatus?: "PREPAID" | "COD" | "UNKNOWN";
  rule: RewardRule;
}): {
  eligible: boolean;
  reason: string;
  amountMinorUnits: string;
  amount: string;
  currencyCode: string;
};

export function calculateEligibleLineSubtotal(
  lineItems: Array<{
    product_id?: string | number;
    quantity: number;
    price: string;
    total_discount?: string;
  }>,
  rule: Pick<RewardRule, "productMode" | "productIds">,
  currencyCode: string,
): string;
