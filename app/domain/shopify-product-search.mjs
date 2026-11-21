/**
 * Convert plain merchant-entered text into a safe Shopify search expression.
 * Each whitespace-delimited term is quoted and terms are ANDed together so
 * text such as "OR" or "title:shirt" cannot change the query structure.
 */
export function toShopifySearchQuery(value) {
  if (typeof value !== "string") {
    throw new TypeError("Product search must be text.");
  }

  const terms = value.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return null;

  return terms
    .map((term) => `"${term.replace(/[\\:()*\"]/g, "\\$&")}"`)
    .join(" AND ");
}
