import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { authenticate } from "../shopify.server";

type ShopifyAdmin = NonNullable<Awaited<ReturnType<typeof authenticate.admin>>["admin"]>;
type PartnerSubscription = {
  trialEndsAt?: string | null;
  cancelAtEndOfCycle?: boolean;
  currentBillingCycle?: { startTime?: string | null; endTime?: string | null } | null;
  items?: Array<{ handle?: string; usage?: { quantity?: number | string | null; cost?: { amount?: number | string | null; currencyCode?: string | null } | null } | null }>;
};
type PartnerResponse = { data?: { activeSubscription?: PartnerSubscription | null }; errors?: Array<{ message?: string }> };
type ShopResponse = { data?: { shop?: { id?: string } | null }; errors?: Array<{ message?: string }> };

export const BILLING_PLANS = {
  starter: { name: "Starter", handle: "starter_plan", monthlyPrice: 0, includedOrders: 100, overageRate: 0.1, trialDays: 0, brandedEmails: false, expiryReminders: false, unlimited: false },
  growth: { name: "Growth", handle: "growth_plan", monthlyPrice: 9, includedOrders: 300, overageRate: 0.1, trialDays: 14, brandedEmails: false, expiryReminders: false, unlimited: false },
  professional: { name: "Professional", handle: "professional_plan", monthlyPrice: 19, includedOrders: 1000, overageRate: 0.1, trialDays: 14, brandedEmails: true, expiryReminders: true, unlimited: false },
  business: { name: "Business", handle: "business_plan", monthlyPrice: 49, includedOrders: null, overageRate: 0, trialDays: 14, brandedEmails: true, expiryReminders: true, unlimited: true },
} as const;

export type BillingPlanKey = keyof typeof BILLING_PLANS;
export type MeteredPlanKey = Exclude<BillingPlanKey, "business">;
export type BillingStatus = {
  configured: boolean; active: boolean; plan: BillingPlanKey | "none" | "unknown"; planName: string;
  monthlyPrice: number | null; includedOrders: number | null; overageRate: number | null; unlimited: boolean;
  emailEntitled: boolean; isTrial: boolean; trialEndsAt: string | null; cycleStart: string | null; cycleEnd: string | null;
  cancelAtEndOfCycle: boolean; usageQuantity: number | null; usageCostAmount: string | null; usageCurrencyCode: string | null;
  shopGid: string | null; message: string;
};

const PLAN_BY_HANDLE = Object.fromEntries(Object.entries(BILLING_PLANS).map(([key, plan]) => [plan.handle, key])) as Record<string, BillingPlanKey>;
const cache = new Map<string, { expiresAt: number; value: BillingStatus }>();
const CACHE_TTL_MS = 45_000;
const SHOP_ID_QUERY = "query CreditFlowShopId { shop { id } }";
const ACTIVE_SUBSCRIPTION_QUERY = "query CreditFlowActiveSubscription($appId: ID!, $shopId: ID!) { activeSubscription(appId: $appId, shopId: $shopId) { trialEndsAt cancelAtEndOfCycle currentBillingCycle { startTime endTime } items { handle usage { quantity cost { amount currencyCode } } } } }";

function isConfigured() {
  return Boolean(process.env.SHOPIFY_PARTNER_ID && process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN && process.env.SHOPIFY_APP_GID && process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET);
}
function emptyStatus(configured: boolean, shopGid: string | null = null): BillingStatus {
  return { configured, active: false, plan: "none", planName: "No plan selected", monthlyPrice: null, includedOrders: null, overageRate: null, unlimited: false, emailEntitled: false, isTrial: false, trialEndsAt: null, cycleStart: null, cycleEnd: null, cancelAtEndOfCycle: false, usageQuantity: null, usageCostAmount: null, usageCurrencyCode: null, shopGid, message: configured ? "No active Shopify App Pricing subscription was found." : "Shopify App Pricing credentials have not been configured for this environment." };
}
async function checkedJson<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) throw new Error(label + " returned HTTP " + response.status + ".");
  return (await response.json()) as T;
}

export async function getBillingStatus(admin: ShopifyAdmin, shop: string, forceRefresh = false): Promise<BillingStatus> {
  const cached = cache.get(shop);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.value;
  if (!isConfigured()) { const value = emptyStatus(false); cache.set(shop, { expiresAt: Date.now() + CACHE_TTL_MS, value }); return value; }
  const orgId = String(process.env.SHOPIFY_PARTNER_ID);
  if (!/^\d+$/.test(orgId)) throw new Error("SHOPIFY_PARTNER_ID must be the numeric Partner organization ID.");
  const shopResponse = await admin.graphql(SHOP_ID_QUERY);
  const shopBody = (await shopResponse.json()) as ShopResponse;
  const shopGid = shopBody.data?.shop?.id;
  if (shopBody.errors?.length || !shopGid) throw new Error("Unable to read the authenticated Shopify shop ID.");
  const apiVersion = process.env.SHOPIFY_PARTNER_API_VERSION || "2026-10";
  const partnerResponse = await fetch("https://partners.shopify.com/" + orgId + "/api/" + apiVersion + "/graphql.json", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": String(process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN), "User-Agent": "CreditFlow/1.0" },
    body: JSON.stringify({ query: ACTIVE_SUBSCRIPTION_QUERY, variables: { appId: process.env.SHOPIFY_APP_GID, shopId: shopGid } }),
  });
  const partnerBody = await checkedJson<PartnerResponse>(partnerResponse, "Shopify Partner API");
  if (partnerBody.errors?.length) throw new Error(partnerBody.errors.map((item) => item.message || "Partner API error").join("; "));
  const subscription = partnerBody.data?.activeSubscription ?? null;
  if (!subscription) { const value = emptyStatus(true, shopGid); cache.set(shop, { expiresAt: Date.now() + CACHE_TTL_MS, value }); return value; }
  const items = subscription.items ?? [];
  const planItem = items.find((item) => item.handle && PLAN_BY_HANDLE[item.handle]);
  const planKey = planItem?.handle ? PLAN_BY_HANDLE[planItem.handle] : undefined;
  const plan = planKey ? BILLING_PLANS[planKey] : null;
  const meter = items.find((item) => item.handle === "orders_processed");
  const quantity = meter?.usage?.quantity == null ? null : Number(meter.usage.quantity);
  const cost = meter?.usage?.cost?.amount == null ? null : String(meter.usage.cost.amount);
  const cycleStart = subscription.currentBillingCycle?.startTime ?? null;
  const cycleEnd = subscription.currentBillingCycle?.endTime ?? null;
  const isTrial = Boolean(subscription.trialEndsAt) || !cycleStart || !cycleEnd;
  const value: BillingStatus = {
    configured: true, active: true, plan: planKey ?? "unknown", planName: plan?.name ?? "Unrecognized plan",
    monthlyPrice: plan?.monthlyPrice ?? null, includedOrders: plan?.includedOrders ?? null, overageRate: plan?.overageRate ?? null,
    unlimited: plan?.unlimited ?? false, emailEntitled: Boolean(plan?.brandedEmails), isTrial,
    trialEndsAt: subscription.trialEndsAt ?? null, cycleStart, cycleEnd, cancelAtEndOfCycle: Boolean(subscription.cancelAtEndOfCycle),
    usageQuantity: Number.isFinite(quantity) ? quantity : null, usageCostAmount: cost,
    usageCurrencyCode: meter?.usage?.cost?.currencyCode ?? null, shopGid,
    message: plan ? (isTrial ? "Your " + plan.name + " trial is active." : plan.name + " is active.") : "A subscription exists, but its plan handle does not match CreditFlow configuration.",
  };
  cache.set(shop, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

export function getPlanSelectionUrl(shop: string) {
  const storeHandle = shop.toLowerCase().replace(/\.myshopify\.com$/, "");
  const appHandle = (process.env.SHOPIFY_APP_HANDLE || "creditflow").toLowerCase();
  if (!/^[a-z0-9-]+$/.test(storeHandle) || !/^[a-z0-9-]+$/.test(appHandle)) throw new Error("Unable to construct Shopify plan-selection URL.");
  return "https://admin.shopify.com/store/" + storeHandle + "/charges/" + appHandle + "/pricing_plans";
}

export async function reserveOrderUsageEvent(db: PrismaClient, shop: string, orderGid: string, planAtOccurrence: MeteredPlanKey, occurredAt: Date = new Date()) {
  const idempotencyKey = createHash("sha256").update("creditflow:orders_processed:" + shop + ":" + orderGid).digest("hex");
  await db.billingUsageEvent.upsert({ where: { shop_orderGid: { shop, orderGid } }, create: { shop, orderGid, planAtOccurrence, idempotencyKey, occurredAt }, update: {} });
}

let tokenCache: { value: string; expiresAt: number } | null = null;
async function getAppEventsToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const response = await fetch("https://api.shopify.com/auth/access_token", {
    method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "CreditFlow/1.0" },
    body: JSON.stringify({ client_id: process.env.SHOPIFY_API_KEY, client_secret: process.env.SHOPIFY_API_SECRET, grant_type: "client_credentials" }),
  });
  const body = await checkedJson<{ access_token?: string; expires_in?: number }>(response, "Shopify App Events token");
  if (!body.access_token) throw new Error("Shopify did not return an App Events access token.");
  tokenCache = { value: body.access_token, expiresAt: Date.now() + Math.max(60, Number(body.expires_in ?? 3600)) * 1000 };
  return tokenCache.value;
}

export async function deliverOrderUsageEvent(args: { admin: ShopifyAdmin; shop: string; orderGid: string; planAtOccurrence: MeteredPlanKey; idempotencyKey: string; occurredAt: Date }): Promise<"SENT" | "SKIPPED" | "REVIEW_REQUIRED"> {
  const status = await getBillingStatus(args.admin, args.shop, true);
  if (!status.active || status.isTrial || status.plan === "business") return "SKIPPED";
  if (status.plan === "none" || status.plan === "unknown" || !status.shopGid || !status.cycleStart || !status.cycleEnd) return "REVIEW_REQUIRED";
  if (status.plan !== args.planAtOccurrence) return "REVIEW_REQUIRED";
  const start = new Date(status.cycleStart).getTime();
  const end = new Date(status.cycleEnd).getTime();
  const timestamp = args.occurredAt.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || timestamp < start || timestamp > end) return "REVIEW_REQUIRED";
  const token = await getAppEventsToken();
  const apiVersion = process.env.SHOPIFY_APP_EVENTS_API_VERSION || "2026-10";
  const response = await fetch("https://api.shopify.com/app/" + apiVersion + "/events", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, "User-Agent": "CreditFlow/1.0" },
    body: JSON.stringify({ shop_id: status.shopGid, event_handle: "orders_processed", timestamp: args.occurredAt.toISOString(), idempotency_key: args.idempotencyKey, attributes: { value: 1 } }),
  });
  let responseBody: { success?: boolean; error?: string } = {};
  try { responseBody = (await response.json()) as typeof responseBody; } catch { /* A successful response may have no JSON body. */ }
  if (!response.ok || responseBody.success === false) throw new Error("Shopify App Events returned HTTP " + response.status + ": " + (responseBody.error || "no error detail") + ".");
  return "SENT";
}
