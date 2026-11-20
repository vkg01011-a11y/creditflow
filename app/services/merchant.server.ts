
import db from "../db.server";

/**
 * Create or reactivate a merchant installation.
 *
 * Shopify session.shop is the trusted shop identifier.
 * Never accept the shop domain from an untrusted form.
 */
export async function activateMerchant(shopDomain: string) {
  const shop = shopDomain.trim().toLowerCase();

  if (!shop) {
    throw new Error("A valid Shopify shop domain is required.");
  }

  return db.merchant.upsert({
    where: { shop },
    create: {
      shop,
      status: "ACTIVE",
    },
    update: {
      status: "ACTIVE",
      uninstalledAt: null,
    },
  });
}

/**
 * Retain financial history when a merchant uninstalls the app.
 */
export async function deactivateMerchant(shopDomain: string) {
  const shop = shopDomain.trim().toLowerCase();

  if (!shop) {
    throw new Error("A valid Shopify shop domain is required.");
  }

  return db.merchant.updateMany({
    where: { shop },
    data: {
      status: "UNINSTALLED",
      uninstalledAt: new Date(),
    },
  });
}
