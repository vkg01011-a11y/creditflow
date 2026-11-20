
import {
  fromMinorUnits,
  percentageToBasisPoints,
  toMinorUnits,
} from "./money.mjs";

function result(
  eligible,
  reason,
  amountMinor = 0n,
  currencyCode = "INR",
) {
  return {
    eligible,
    reason,
    amountMinorUnits: amountMinor.toString(),
    amount: fromMinorUnits(amountMinor, currencyCode),
    currencyCode,
  };
}

const NUMERIC_OPERATORS = new Set([
  "EQUALS",
  "NOT_EQUALS",
  "GREATER_THAN",
  "GREATER_THAN_OR_EQUAL",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
]);

const TEXT_OPERATORS = new Set([
  "EQUALS",
  "NOT_EQUALS",
  "CONTAINS",
  "NOT_CONTAINS",
]);

function compareBigInt(actual, expected, operator) {
  switch (operator) {
    case "EQUALS":
      return actual === expected;
    case "NOT_EQUALS":
      return actual !== expected;
    case "GREATER_THAN":
      return actual > expected;
    case "GREATER_THAN_OR_EQUAL":
      return actual >= expected;
    case "LESS_THAN":
      return actual < expected;
    case "LESS_THAN_OR_EQUAL":
      return actual <= expected;
    default:
      return false;
  }
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function splitValues(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === "object" && item !== null
          ? item.code ?? ""
          : item,
      )
      .map(normalizeText)
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map(normalizeText)
      .filter(Boolean);
  }

  return [];
}

function getOrderQuantity(order) {
  let total = 0n;

  for (const line of order?.line_items ?? []) {
    try {
      const quantity = BigInt(String(line.quantity ?? 0));

      if (quantity > 0n) {
        total += quantity;
      }
    } catch {
      // Invalid line quantity is ignored.
    }
  }

  return total;
}

function evaluateCondition(condition, context) {
  const field = condition?.field;
  const operator = condition?.operator;
  const expected = String(condition?.value ?? "");

  if (!field || !operator || !expected.trim()) {
    return false;
  }

  const {
    order,
    orderSubtotal,
    currencyCode,
    paymentStatus,
    customer,
  } = context;

  // Money conditions use integer minor units, never floating-point comparisons.
  if (field === "ORDER_SUBTOTAL") {
    if (!NUMERIC_OPERATORS.has(operator)) return false;

    try {
      const actual = toMinorUnits(orderSubtotal, currencyCode);
      const target = toMinorUnits(expected, currencyCode);

      return compareBigInt(actual, target, operator);
    } catch {
      return false;
    }
  }

  if (field === "ITEM_QUANTITY") {
    if (!NUMERIC_OPERATORS.has(operator)) return false;
    if (!/^\d+$/.test(expected)) return false;

    return compareBigInt(
      getOrderQuantity(order),
      BigInt(expected),
      operator,
    );
  }

  if (field === "CUSTOMER_ORDER_COUNT") {
    if (!NUMERIC_OPERATORS.has(operator)) return false;
    if (!customer || !/^\d+$/.test(expected)) return false;

    try {
      const actual = BigInt(String(customer.numberOfOrders ?? ""));
      const target = BigInt(expected);

      return compareBigInt(actual, target, operator);
    } catch {
      return false;
    }
  }

  if (field === "PAYMENT_STATUS") {
    if (!["EQUALS", "NOT_EQUALS"].includes(operator)) return false;

    const actual = normalizeText(paymentStatus);
    const target = normalizeText(expected);

    if (!actual) return false;

    return operator === "EQUALS"
      ? actual === target
      : actual !== target;
  }

  if (field === "CUSTOMER_TAG") {
    if (!customer || !Array.isArray(customer.tags)) return false;

    return compareTextList(customer.tags, expected, operator);
  }

  if (field === "ORDER_TAG") {
    const tags = splitValues(order?.tags);
    return compareTextList(tags, expected, operator);
  }

  if (field === "DISCOUNT_CODE") {
    const codes = splitValues(order?.discount_codes);
    return compareTextList(codes, expected, operator);
  }

  if (field === "SHIPPING_COUNTRY") {
    if (!["EQUALS", "NOT_EQUALS"].includes(operator)) return false;

    const actual = normalizeText(
      order?.shipping_address?.country_code ??
      order?.shipping_address?.country_code_v2,
    );

    const target = normalizeText(expected);

    // Missing country data must not accidentally satisfy a negative condition.
    if (!actual || !target) return false;

    return operator === "EQUALS"
      ? actual === target
      : actual !== target;
  }

  // Unknown condition fields fail closed.
  return false;
}

function compareTextList(values, expected, operator) {
  if (!TEXT_OPERATORS.has(operator)) return false;

  const target = normalizeText(expected);

  if (!target) return false;

  const found = values
    .map(normalizeText)
    .includes(target);

  switch (operator) {
    case "EQUALS":
    case "CONTAINS":
      return found;

    case "NOT_EQUALS":
    case "NOT_CONTAINS":
      return !found;

    default:
      return false;
  }
}

/**
 * Evaluates a merchant-defined condition group.
 *
 * Supported condition fields:
 * ORDER_SUBTOTAL
 * ITEM_QUANTITY
 * PAYMENT_STATUS
 * ORDER_TAG
 * DISCOUNT_CODE
 * SHIPPING_COUNTRY
 * CUSTOMER_TAG
 * CUSTOMER_ORDER_COUNT
 *
 * An absent or empty condition group imposes no additional restriction.
 * Invalid or unavailable customer data fails closed for customer conditions.
 */
export function matchesRuleConditions({
  order,
  conditions,
  orderSubtotal,
  currencyCode,
  paymentStatus = "UNKNOWN",
  customer = null,
}) {
  if (conditions == null) return true;

  if (
    typeof conditions !== "object" ||
    Array.isArray(conditions)
  ) {
    return false;
  }

  const logic = conditions.logic ?? "AND";
  const rules = conditions.rules ?? [];

  if (
    !["AND", "OR"].includes(logic) ||
    !Array.isArray(rules)
  ) {
    return false;
  }

  if (rules.length === 0) return true;

  const context = {
    order,
    orderSubtotal,
    currencyCode,
    paymentStatus,
    customer,
  };

  const results = rules.map((condition) =>
    evaluateCondition(condition, context),
  );

  return logic === "OR"
    ? results.some(Boolean)
    : results.every(Boolean);
}

/**
 * Calculates one order-level reward.
 * The caller supplies the eligible product subtotal after line discounts.
 */
export function calculateReward({
  orderSubtotal,
  eligibleSubtotal,
  currencyCode,
  paymentStatus = "UNKNOWN",
  rule,
}) {
  if (!rule || rule.enabled === false) {
    return result(false, "RULE_DISABLED", 0n, currencyCode);
  }

  if (!currencyCode) {
    throw new TypeError("currencyCode is required");
  }

  const orderMinor = toMinorUnits(orderSubtotal, currencyCode);

  const eligibleMinor = toMinorUnits(
    eligibleSubtotal ?? orderSubtotal,
    currencyCode,
  );

  if (
    rule.requirePrepaid &&
    paymentStatus !== "PREPAID"
  ) {
    return result(
      false,
      "PREPAID_PAYMENT_REQUIRED",
      0n,
      currencyCode,
    );
  }

  if (rule.minimumOrderValue != null) {
    const minimumMinor = toMinorUnits(
      rule.minimumOrderValue,
      currencyCode,
    );

    if (orderMinor < minimumMinor) {
      return result(
        false,
        "MINIMUM_ORDER_VALUE_NOT_MET",
        0n,
        currencyCode,
      );
    }
  }

  const base =
    rule.rewardBase === "ELIGIBLE_ITEMS"
      ? eligibleMinor
      : orderMinor;

  if (base <= 0n) {
    return result(false, "NO_ELIGIBLE_VALUE", 0n, currencyCode);
  }

  let rewardMinor;

  if (rule.rewardType === "FIXED") {
    rewardMinor = toMinorUnits(rule.fixedAmount, currencyCode);
  } else if (rule.rewardType === "PERCENTAGE") {
    const basisPoints = percentageToBasisPoints(rule.percentage);

    // Always round down to avoid over-issuing credit.
    rewardMinor = (base * basisPoints) / 10000n;
  } else {
    throw new TypeError(
      `Unsupported rewardType: ${rule.rewardType}`,
    );
  }

  if (rule.maximumReward != null) {
    const capMinor = toMinorUnits(
      rule.maximumReward,
      currencyCode,
    );

    if (rewardMinor > capMinor) {
      rewardMinor = capMinor;
    }
  }

  if (rewardMinor <= 0n) {
    return result(
      false,
      "CALCULATED_REWARD_IS_ZERO",
      0n,
      currencyCode,
    );
  }

  return result(true, "REWARD_CALCULATED", rewardMinor, currencyCode);
}

/**
 * Calculates post-discount value for ALL / INCLUDE / EXCLUDE product rules.
 */
export function calculateEligibleLineSubtotal(
  lineItems,
  rule,
  currencyCode,
) {
  const mode = rule.productMode || "ALL";
  const productIds = new Set(
    (rule.productIds || []).map(String),
  );

  let total = 0n;

  for (const line of lineItems || []) {
    const productId = String(line.product_id ?? "");

    const included =
      mode === "ALL" ||
      (mode === "INCLUDE" && productIds.has(productId)) ||
      (mode === "EXCLUDE" && !productIds.has(productId));

    if (!included) continue;

    const quantity = BigInt(line.quantity ?? 0);

    if (quantity <= 0n) continue;

    const unitPrice = toMinorUnits(
      String(line.price ?? "0"),
      currencyCode,
    );

    const lineDiscount = toMinorUnits(
      String(line.total_discount ?? "0"),
      currencyCode,
    );

    const gross = unitPrice * quantity;
    const net = gross > lineDiscount
      ? gross - lineDiscount
      : 0n;

    total += net;
  }

  return fromMinorUnits(total, currencyCode);
}
