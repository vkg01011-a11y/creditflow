import test from "node:test";
import assert from "node:assert/strict";

import { buildShopifyPlanSelectionUrl } from "../app/domain/pricing-url.mjs";

test("builds the Shopify-hosted plan URL with the configured app handle", () => {
  assert.equal(
    buildShopifyPlanSelectionUrl("CreditFlow-Dev-Vivek.myshopify.com", "creditflow-1"),
    "https://admin.shopify.com/store/creditflow-dev-vivek/charges/creditflow-1/pricing_plans",
  );
});

test("uses CreditFlow's verified staging app handle by default", () => {
  assert.equal(
    buildShopifyPlanSelectionUrl("creditflow-dev-vivek.myshopify.com"),
    "https://admin.shopify.com/store/creditflow-dev-vivek/charges/creditflow-1/pricing_plans",
  );
});

test("rejects unsafe store or app handles", () => {
  assert.throws(() => buildShopifyPlanSelectionUrl("invalid/store.myshopify.com"), /plan-selection URL/);
  assert.throws(() => buildShopifyPlanSelectionUrl("creditflow-dev.myshopify.com", "bad/handle"), /plan-selection URL/);
});
