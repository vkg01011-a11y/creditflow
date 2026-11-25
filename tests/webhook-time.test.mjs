import test from "node:test";
import assert from "node:assert/strict";

import { parseShopifyTriggeredAt } from "../app/domain/webhook-time.mjs";

test("parses Shopify's original webhook trigger timestamp", () => {
  const result = parseShopifyTriggeredAt("2026-11-25T12:34:56.000Z");
  assert.ok(result instanceof Date);
  assert.equal(result.toISOString(), "2026-11-25T12:34:56.000Z");
});

test("returns null when Shopify trigger timestamp is missing or invalid", () => {
  assert.equal(parseShopifyTriggeredAt(null), null);
  assert.equal(parseShopifyTriggeredAt(undefined), null);
  assert.equal(parseShopifyTriggeredAt(""), null);
  assert.equal(parseShopifyTriggeredAt("not-a-timestamp"), null);
});
