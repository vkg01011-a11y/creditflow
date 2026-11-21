import db from "../db.server";

const SHOP_METADATA_TTL_MS = 24 * 60 * 60 * 1000;
const SHOP_METADATA_REFRESH_LEASE_MS = 60 * 1000;
const SHOP_METADATA_RETRY_DELAY_MS = 5 * 60 * 1000;

type ShopMetadata = {
  storeName: string;
  currencyCode: string | null;
};

type MerchantMetadataRecord = {
  shopName: string | null;
  primaryCurrencyCode: string | null;
  shopMetadataSyncedAt: Date | null;
  shopMetadataRetryAfter: Date | null;
};

type ShopMetadataPayload = {
  errors?: Array<{ message?: string }>;
  data?: {
    shop?: {
      name?: string | null;
      currencyCode?: string | null;
    } | null;
  } | null;
};

/**
 * Create or reactivate a merchant installation.
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
 * Read per-shop metadata from PostgreSQL and refresh it every 24 hours.
 * One PostgreSQL row-level conditional update coordinates refreshes across
 * app instances. A failed Shopify request serves stale metadata and applies
 * a five-minute retry backoff, avoiding repeated Admin API calls during an outage.
 */
export async function getShopMetadata(
  shopDomain: string,
  fetchShop: () => Promise<Response>,
): Promise<ShopMetadata> {
  const shop = shopDomain.trim().toLowerCase();

  if (!shop) {
    throw new Error("A valid Shopify shop domain is required.");
  }

  const select = {
    shopName: true,
    primaryCurrencyCode: true,
    shopMetadataSyncedAt: true,
    shopMetadataRetryAfter: true,
  } as const;

  let merchant: MerchantMetadataRecord | null =
    await db.merchant.findUnique({
      where: { shop },
      select,
    });

  // Normally created by Shopify's afterAuth hook. Recover older installations
  // with one upsert and avoid a second read.
  if (!merchant) {
    const created = await activateMerchant(shop);
    merchant = {
      shopName: created.shopName,
      primaryCurrencyCode: created.primaryCurrencyCode,
      shopMetadataSyncedAt: created.shopMetadataSyncedAt,
      shopMetadataRetryAfter: created.shopMetadataRetryAfter,
    };
  }

  const now = Date.now();
  const syncedAt = merchant.shopMetadataSyncedAt?.getTime() ?? 0;
  const retryAfter = merchant.shopMetadataRetryAfter?.getTime() ?? 0;
  const cacheIsFresh = syncedAt > 0 && now - syncedAt < SHOP_METADATA_TTL_MS;
  const retryIsBackedOff = retryAfter > now;

  if (cacheIsFresh || retryIsBackedOff) {
    return {
      storeName: merchant.shopName || shop,
      currencyCode: merchant.primaryCurrencyCode,
    };
  }

  // Claim a short shared refresh lease. updateMany is conditional and atomic:
  // only one app instance can refresh a stale merchant row at a time.
  const nowDate = new Date(now);
  const staleMetadataCondition = merchant.shopMetadataSyncedAt
    ? {
        shopMetadataSyncedAt: {
          lte: new Date(now - SHOP_METADATA_TTL_MS),
        },
      }
    : { shopMetadataSyncedAt: null };

  const refreshClaim = await db.merchant.updateMany({
    where: {
      shop,
      ...staleMetadataCondition,
      OR: [
        { shopMetadataRetryAfter: null },
        { shopMetadataRetryAfter: { lte: nowDate } },
      ],
    },
    data: {
      shopMetadataRetryAfter: new Date(
        now + SHOP_METADATA_REFRESH_LEASE_MS,
      ),
    },
  });

  if (refreshClaim.count === 0) {
    // Another instance won the lease. Re-read in case it completed quickly;
    // otherwise return the previous values instead of duplicate Shopify calls.
    const latest = await db.merchant.findUnique({
      where: { shop },
      select,
    });
    const latestSyncedAt = latest?.shopMetadataSyncedAt?.getTime() ?? 0;

    if (
      latest &&
      latestSyncedAt > 0 &&
      Date.now() - latestSyncedAt < SHOP_METADATA_TTL_MS
    ) {
      return {
        storeName: latest.shopName || shop,
        currencyCode: latest.primaryCurrencyCode,
      };
    }

    return {
      storeName: latest?.shopName || merchant.shopName || shop,
      currencyCode:
        latest?.primaryCurrencyCode ?? merchant.primaryCurrencyCode,
    };
  }

  try {
    const response = await fetchShop();

    if (!response.ok) {
      throw new Error(`Shopify returned HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as ShopMetadataPayload;

    if (payload.errors?.length || !payload.data?.shop) {
      throw new Error(
        payload.errors
          ?.map((error) => error.message || "Unknown GraphQL error")
          .join("; ") || "Shop information was not returned by Shopify.",
      );
    }

    const fetchedName = payload.data.shop.name?.trim() || null;
    const fetchedCurrency =
      payload.data.shop.currencyCode?.trim().toUpperCase() || null;

    if (!fetchedName || !fetchedCurrency) {
      throw new Error("Shopify returned incomplete shop metadata.");
    }

    if (!/^[A-Z]{3}$/.test(fetchedCurrency)) {
      throw new Error("Shopify returned an invalid currency code.");
    }

    await db.merchant.update({
      where: { shop },
      data: {
        shopName: fetchedName,
        primaryCurrencyCode: fetchedCurrency,
        shopMetadataSyncedAt: new Date(),
        shopMetadataRetryAfter: null,
      },
    });

    return {
      storeName: fetchedName,
      currencyCode: fetchedCurrency,
    };
  } catch (error) {
    console.warn(
      "[CreditFlow] Shopify shop metadata refresh failed:",
      error,
    );

    // A retry timestamp is shared by all app instances through PostgreSQL.
    // Keep this best-effort: a metadata failure should not erase stale values.
    try {
      await db.merchant.update({
        where: { shop },
        data: {
          shopMetadataRetryAfter: new Date(
            Date.now() + SHOP_METADATA_RETRY_DELAY_MS,
          ),
        },
      });
    } catch (cacheError) {
      console.warn(
        "[CreditFlow] Unable to persist metadata retry backoff:",
        cacheError,
      );
    }

    return {
      storeName: merchant.shopName || shop,
      currencyCode: merchant.primaryCurrencyCode,
    };
  }
}

/** Retain financial history when a merchant uninstalls the app. */
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
