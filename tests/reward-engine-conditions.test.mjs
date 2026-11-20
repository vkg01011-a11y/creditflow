
import test from "node:test";
import assert from "node:assert/strict";

import {
  matchesRuleConditions,
} from "../app/domain/reward-engine.mjs";

const order = {
  tags: "VIP, Summer Sale",
  discount_codes: [{ code: "WELCOME10" }],
  line_items: [
    { quantity: 2 },
    { quantity: 1 },
  ],
  shipping_address: {
    country_code: "IN",
  },
};

const base = {
  order,
  orderSubtotal: "10000.00",
  currencyCode: "INR",
  paymentStatus: "PREPAID",
  customer: {
    tags: ["VIP", "Returning"],
    numberOfOrders: "5",
  },
};

test("AND requires every condition to match", () => {
  const matched = matchesRuleConditions({
    ...base,
    conditions: {
      version: 1,
      logic: "AND",
      rules: [
        {
          field: "ORDER_SUBTOTAL",
          operator: "GREATER_THAN_OR_EQUAL",
          value: "5000",
        },
        {
          field: "ITEM_QUANTITY",
          operator: "GREATER_THAN",
          value: "2",
        },
        {
          field: "PAYMENT_STATUS",
          operator: "EQUALS",
          value: "PREPAID",
        },
      ],
    },
  });

  assert.equal(matched, true);
});

test("AND fails when one condition does not match", () => {
  const matched = matchesRuleConditions({
    ...base,
    conditions: {
      version: 1,
      logic: "AND",
      rules: [
        {
          field: "ORDER_SUBTOTAL",
          operator: "GREATER_THAN_OR_EQUAL",
          value: "5000",
        },
        {
          field: "ITEM_QUANTITY",
          operator: "GREATER_THAN",
          value: "5",
        },
      ],
    },
  });

  assert.equal(matched, false);
});

test("OR passes when at least one condition matches", () => {
  const matched = matchesRuleConditions({
    ...base,
    conditions: {
      version: 1,
      logic: "OR",
      rules: [
        {
          field: "ORDER_SUBTOTAL",
          operator: "GREATER_THAN",
          value: "50000",
        },
        {
          field: "ITEM_QUANTITY",
          operator: "GREATER_THAN_OR_EQUAL",
          value: "3",
        },
      ],
    },
  });

  assert.equal(matched, true);
});

test("matches customer tags", () => {
  const matched = matchesRuleConditions({
    ...base,
    conditions: {
      version: 1,
      logic: "AND",
      rules: [
        {
          field: "CUSTOMER_TAG",
          operator: "CONTAINS",
          value: "vip",
        },
      ],
    },
  });

  assert.equal(matched, true);
});

test("matches customer order count", () => {
  const matched = matchesRuleConditions({
    ...base,
    conditions: {
      version: 1,
      logic: "AND",
      rules: [
        {
          field: "CUSTOMER_ORDER_COUNT",
          operator: "GREATER_THAN_OR_EQUAL",
          value: "5",
        },
      ],
    },
  });

  assert.equal(matched, true);
});

test("customer conditions fail closed when customer data is missing", () => {
  const matched = matchesRuleConditions({
    ...base,
    customer: null,
    conditions: {
      version: 1,
      logic: "AND",
      rules: [
        {
          field: "CUSTOMER_TAG",
          operator: "NOT_CONTAINS",
          value: "blocked",
        },
      ],
    },
  });

  assert.equal(matched, false);
});

test("matches order tags and discount codes", () => {
  const matched = matchesRuleConditions({
    ...base,
    conditions: {
      version: 1,
      logic: "AND",
      rules: [
        {
          field: "ORDER_TAG",
          operator: "CONTAINS",
          value: "summer sale",
        },
        {
          field: "DISCOUNT_CODE",
          operator: "CONTAINS",
          value: "welcome10",
        },
      ],
    },
  });

  assert.equal(matched, true);
});

test("matches shipping country codes", () => {
  const matched = matchesRuleConditions({
    ...base,
    conditions: {
      version: 1,
      logic: "AND",
      rules: [
        {
          field: "SHIPPING_COUNTRY",
          operator: "EQUALS",
          value: "IN",
        },
      ],
    },
  });

  assert.equal(matched, true);
});

test("an empty condition group imposes no additional restriction", () => {
  assert.equal(
    matchesRuleConditions({
      ...base,
      conditions: {
        version: 1,
        logic: "AND",
        rules: [],
      },
    }),
    true,
  );
});
