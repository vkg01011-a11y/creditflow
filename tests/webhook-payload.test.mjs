import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeCustomerPrivacyPayload,
  normalizeFulfillmentOrder,
  normalizeRefundPayload,
} from "../app/domain/webhook-payload.mjs";

test("normalizes only the fulfillment fields needed by reward evaluation", () => {
  const result = normalizeFulfillmentOrder({
    id: 123,
    name: "#123",
    fulfillment_status: "fulfilled",
    admin_graphql_api_id: "gid://shopify/Order/123",
    customer: {
      id: 456,
      email: "customer@example.com",
      phone: "+10000000000",
    },
    currency: "USD",
    financial_status: "paid",
    payment_gateway_names: ["shopify_payments"],
    current_subtotal_price: "120.00",
    tags: "VIP",
    shipping_address: {
      country_code: "US",
      address1: "Private street",
      city: "Private city",
    },
    line_items: [
      {
        product_id: 99,
        quantity: 2,
        price: "60.00",
        total_discount: "0.00",
        title: "Private item title",
      },
    ],
  });

  assert.equal(result.admin_graphql_api_id, "gid://shopify/Order/123");
  assert.equal(
    result.customer?.admin_graphql_api_id,
    "gid://shopify/Customer/456",
  );
  assert.equal(result.line_items.length, 1);
  assert.deepEqual(result.shipping_address, {
    country_code: "US",
    country_code_v2: null,
  });
  assert.equal("email" in result.customer, false);
  assert.equal("address1" in result.shipping_address, false);
  assert.equal("title" in result.line_items[0], false);
});

test("rejects fulfillment events without a valid order ID", () => {
  assert.throws(
    () => normalizeFulfillmentOrder({ name: "#Missing ID" }),
    /valid order ID/,
  );
});

test("normalizes customer data request IDs to Shopify GIDs", () => {
  assert.deepEqual(
    normalizeCustomerPrivacyPayload("CUSTOMERS_DATA_REQUEST", {
      customer: { id: 456, email: "customer@example.com" },
      orders_requested: [123, "gid://shopify/Order/789"],
    }),
    {
      customerGid: "gid://shopify/Customer/456",
      requestedOrderIds: [
        "gid://shopify/Order/123",
        "gid://shopify/Order/789",
      ],
    },
  );
});

test("rejects customer redaction requests without a customer ID", () => {
  assert.throws(
    () => normalizeCustomerPrivacyPayload("CUSTOMERS_REDACT", { customer: {} }),
    /valid customer ID/,
  );
});

test("normalizes shop redaction without retaining unrelated payload data", () => {
  assert.deepEqual(
    normalizeCustomerPrivacyPayload("SHOP_REDACT", {
      shop_id: 789,
      shop_domain: "example.myshopify.com",
      unrelated: "not stored",
    }),
    { shopId: "789" },
  );
});

test("normalizes refund line items and removes unrelated refund/customer data", () => {
  const result = normalizeRefundPayload({
    id: 900,
    order_id: 123,
    note: "Sensitive merchant note",
    transactions: [{ amount: "50.00", gateway: "private gateway" }],
    refund_line_items: [
      {
        id: 901,
        quantity: 1,
        subtotal: "25.00",
        subtotal_set: {
          shop_money: { amount: "25.00", currency_code: "USD" },
          presentment_money: { amount: "23.00", currency_code: "EUR" },
        },
        line_item: {
          product_id: 456,
          title: "Private item title",
          sku: "PRIVATE-SKU",
        },
      },
    ],
  });

  assert.deepEqual(result, {
    refundGid: "gid://shopify/Refund/900",
    orderGid: "gid://shopify/Order/123",
    lineItems: [{
      productId: "456",
      subtotal: "25.00",
      currencyCode: "USD",
    }],
  });
  assert.equal("transactions" in result, false);
  assert.equal("note" in result, false);
});

test("rejects refund payloads without valid refund and order IDs", () => {
  assert.throws(
    () => normalizeRefundPayload({ order_id: 123 }),
    /valid refund ID/,
  );
  assert.throws(
    () => normalizeRefundPayload({ id: 900 }),
    /valid order ID/,
  );
});

test("rejects refund line items with invalid subtotals", () => {
  assert.throws(
    () => normalizeRefundPayload({
      id: 900,
      order_id: 123,
      refund_line_items: [{
        line_item: { product_id: 456 },
        subtotal: "not-money",
      }],
    }),
    /valid subtotal/,
  );
});
