import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeCustomerPrivacyPayload,
  normalizeFulfillmentOrder,
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
