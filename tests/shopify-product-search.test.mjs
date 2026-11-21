import test from "node:test";
import assert from "node:assert/strict";

import { toShopifySearchQuery } from "../app/domain/shopify-product-search.mjs";

test("returns null for an empty product search", () => {
  assert.equal(toShopifySearchQuery(""), null);
  assert.equal(toShopifySearchQuery("   \t\n  "), null);
});

test("quotes plain search terms and combines them with AND", () => {
  assert.equal(
    toShopifySearchQuery("red leather bag"),
    '"red" AND "leather" AND "bag"',
  );
});

test("does not allow words such as OR to become Shopify connectives", () => {
  assert.equal(
    toShopifySearchQuery("red OR blue"),
    '"red" AND "OR" AND "blue"',
  );
});

test("escapes Shopify search grammar characters", () => {
  assert.equal(
    toShopifySearchQuery('title:(red) "bag"\\case *'),
    String.raw`"title\:\(red\)" AND "\"bag\"\\case" AND "\*"`,
  );
});

test("rejects non-string input", () => {
  assert.throws(() => toShopifySearchQuery(null), TypeError);
});
