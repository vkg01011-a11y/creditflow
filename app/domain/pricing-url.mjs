export function buildShopifyPlanSelectionUrl(shop, appHandle = "creditflow-1") {
  const storeHandle = String(shop ?? "")
    .toLowerCase()
    .replace(/\.myshopify\.com$/, "");
  const normalizedAppHandle = String(appHandle ?? "").toLowerCase();
  if (!/^[a-z0-9-]+$/.test(storeHandle) || !/^[a-z0-9-]+$/.test(normalizedAppHandle)) {
    throw new Error("Unable to construct Shopify plan-selection URL.");
  }
  return `https://admin.shopify.com/store/${storeHandle}/charges/${normalizedAppHandle}/pricing_plans`;
}
