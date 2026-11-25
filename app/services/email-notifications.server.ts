import type { PrismaClient } from "@prisma/client";
import type { authenticate } from "../shopify.server";
import { getBillingStatus } from "./billing.server";
import { renderCreditEmail } from "../domain/email-template.mjs";
import { getWebhookRetryDelayMs, MAX_WEBHOOK_ATTEMPTS } from "../domain/webhook-retry.mjs";

type JsonRecord = Record<string, unknown>;

type ShopifyAdmin = NonNullable<
  Awaited<ReturnType<typeof authenticate.webhook>>["admin"]
>;

type NotificationLike = {
  id: string;
  shop: string;
  customerGid: string;
  dedupeKey: string;
  type: "CREDIT_ISSUED" | "CREDIT_EXPIRING";
  templateKey: string;
  metadata: unknown;
  attemptCount: number;
};

type ShopifyNotificationContext = {
  errors?: Array<{ message?: string }>;
  data?: {
    customer?: {
      email?: string | null;
      firstName?: string | null;
    } | null;
    storeCreditAccount?: {
      id: string;
      balance?: { amount: string; currencyCode: string } | null;
      transactions?: {
        edges?: Array<{
          node?: {
            id?: string;
            expiresAt?: string | null;
            remainingAmount?: { amount: string; currencyCode: string } | null;
          } | null;
        }>;
      };
    } | null;
    shop?: {
      name?: string | null;
      ianaTimezone?: string | null;
      myshopifyDomain?: string | null;
      primaryDomain?: { url?: string | null } | null;
    } | null;
  };
};

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function safeMessage(value: unknown) {
  if (!(value instanceof Error)) return "Email delivery failed.";

  return value.message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}/gi, "[email]")
    .replace(/re_[A-Za-z0-9_-]{16,}/g, "[provider-key]")
    .slice(0, 1000);
}

function formatMoney(amount: string, currencyCode: string) {
  const number = Number(amount);
  if (!Number.isFinite(number)) return currencyCode + " " + amount;

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 3,
    }).format(number);
  } catch {
    return currencyCode + " " + number.toLocaleString();
  }
}

function formatExpiryDate(value: string, timezone?: string | null) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "long",
      timeZone: timezone || "UTC",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(date);
  }
}

function senderAddress(storeName: string, senderName?: string | null) {
  const configured = process.env.CREDITFLOW_EMAIL_FROM?.trim();
  if (!configured) {
    throw new Error("CreditFlow email sender is not configured.");
  }

  const match = configured.match(/<([^<>]+)>/);
  const address = match?.[1]?.trim() ?? configured;

  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address)) {
    throw new Error("CreditFlow email sender address is invalid.");
  }

  const name = (senderName?.trim() || storeName || "Store credit")
    .replace(/[\r\n<>"]/g, "")
    .slice(0, 100);

  return name + " <" + address + ">";
}

function shopUrl(context: ShopifyNotificationContext, shop: string) {
  const candidate =
    context.data?.shop?.primaryDomain?.url ||
    (context.data?.shop?.myshopifyDomain
      ? "https://" + context.data.shop.myshopifyDomain
      : "https://" + shop);

  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.toString() : "https://" + shop;
  } catch {
    return "https://" + shop;
  }
}

async function getShopifyNotificationContext(
  admin: ShopifyAdmin,
  customerGid: string,
  accountGid: string,
  transactionGid: string,
): Promise<ShopifyNotificationContext> {
  const response = await admin.graphql(
    `#graphql
      query CreditFlowEmailContext($customerId: ID!, $accountId: ID!, $transactionQuery: String!) {
        customer(id: $customerId) {
          email
          firstName
        }
        storeCreditAccount(id: $accountId) {
          id
          balance {
            amount
            currencyCode
          }
          transactions(first: 1, query: $transactionQuery) {
            edges {
              node {
                ... on StoreCreditAccountCreditTransaction {
                  id
                  expiresAt
                  remainingAmount {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
        shop {
          name
          ianaTimezone
          myshopifyDomain
          primaryDomain {
            url
          }
        }
      }
    `,
    {
      variables: {
        customerId: customerGid,
        accountId: accountGid,
        transactionQuery: "type:credit AND id:" + transactionGid.split("/").pop(),
      },
    },
  );

  const body = (await response.json()) as ShopifyNotificationContext;
  if (body.errors?.length) {
    throw new Error(
      body.errors.map((item) => item.message || "Shopify query failed").join("; "),
    );
  }
  return body;
}

async function sendWithResend({
  to,
  from,
  replyTo,
  subject,
  html,
  text,
  idempotencyKey,
}: {
  to: string;
  from: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("Transactional email provider is not configured.");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey.slice(0, 256),
      "User-Agent": "CreditFlow/1.0",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  const payload = await response.json().catch(() => ({})) as {
    id?: string;
    message?: string;
    error?: { message?: string };
  };

  if (!response.ok || !payload.id) {
    throw new Error(
      payload.error?.message || payload.message ||
      "Email provider rejected the message (HTTP " + response.status + ").",
    );
  }

  return payload.id;
}

export async function queueExpiringCreditNotifications(
  db: PrismaClient,
  now = new Date(),
  excludedShops: string[] = [],
) {
  const scanThreshold = new Date(now.getTime() - 23 * 60 * 60 * 1000);
  const settingsRows = await db.emailNotificationSettings.findMany({
    where: {
      ...(excludedShops.length > 0 ? { shop: { notIn: excludedShops } } : {}),
      expiryReminderEnabled: true,
      OR: [
        { lastExpiryScanAt: null },
        { lastExpiryScanAt: { lte: scanThreshold } },
      ],
    },
    orderBy: { lastExpiryScanAt: "asc" },
    take: 100,
  });

  let queued = 0;
  const dayMs = 24 * 60 * 60 * 1000;

  for (const settings of settingsRows) {
    const claimed = await db.emailNotificationSettings.updateMany({
      where: {
        id: settings.id,
        lastExpiryScanAt: settings.lastExpiryScanAt,
        expiryReminderEnabled: true,
      },
      data: { lastExpiryScanAt: now },
    });
    if (claimed.count === 0) continue;

    try {
      const rawDays = Array.isArray(settings.expiryReminderDays)
        ? settings.expiryReminderDays
        : [7, 1];
      const reminderDays = [...new Set(
        rawDays
          .map(Number)
          .filter((day) => Number.isInteger(day) && day >= 1 && day <= 30),
      )].sort((a, b) => a - b);

      if (reminderDays.length === 0) continue;

      const maxExpiry = new Date(now.getTime() + Math.max(...reminderDays) * dayMs);
      const grants = await db.creditGrant.findMany({
        where: {
          shop: settings.shop,
          status: { in: ["ISSUED", "PARTIALLY_REVERSED"] },
          expiresAt: { gt: now, lte: maxExpiry },
          shopifyAccountGid: { not: null },
          shopifyTransactionGid: { not: null },
        },
        orderBy: { expiresAt: "asc" },
        take: 500,
        select: {
          id: true,
          customerGid: true,
          amount: true,
          currencyCode: true,
          expiresAt: true,
          shopifyAccountGid: true,
          shopifyTransactionGid: true,
        },
      });

      const notifications = [];
      for (const grant of grants) {
        if (!grant.expiresAt || !grant.shopifyAccountGid || !grant.shopifyTransactionGid) continue;
        const daysRemaining = Math.max(
          1,
          Math.ceil((grant.expiresAt.getTime() - now.getTime()) / dayMs),
        );
        const reminderDay = reminderDays.find((day) => daysRemaining <= day);
        if (!reminderDay) continue;

        notifications.push({
          shop: settings.shop,
          customerGid: grant.customerGid,
          dedupeKey: "credit-expiring:" + settings.shop + ":" + grant.id + ":" + reminderDay,
          type: "CREDIT_EXPIRING" as const,
          status: "QUEUED" as const,
          templateKey: "CREDIT_EXPIRING",
          scheduledAt: now,
          metadata: {
            creditGrantId: grant.id,
            amount: String(grant.amount),
            currencyCode: grant.currencyCode,
            expiresAt: grant.expiresAt.toISOString(),
            shopifyAccountGid: grant.shopifyAccountGid,
            shopifyTransactionGid: grant.shopifyTransactionGid,
            reminderDays: reminderDay,
          },
        });
      }

      if (notifications.length > 0) {
        const result = await db.notification.createMany({
          data: notifications,
          skipDuplicates: true,
        });
        queued += result.count;
      }
    } catch (error) {
      await db.emailNotificationSettings.updateMany({
        where: { id: settings.id, lastExpiryScanAt: now },
        data: { lastExpiryScanAt: settings.lastExpiryScanAt },
      });
      console.error("[CreditFlow] Expiry notification scan failed", {
        shop: settings.shop,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  return { queued };
}

export async function processCreditEmailNotification({
  db,
  admin,
  notification,
}: {
  db: PrismaClient;
  admin: ShopifyAdmin;
  notification: NotificationLike;
}): Promise<{ status: "SENT" | "SKIPPED"; providerMessageId?: string }> {
  const metadata = asRecord(notification.metadata);
  const isIssued = notification.type === "CREDIT_ISSUED";

  // Credit-issued email mode is snapshotted on the grant. Preserve an already
  // queued branded message because Shopify native email was suppressed for it.
  // Expiry reminders are future premium actions and require current entitlement.
  if (!isIssued) {
    const billing = await getBillingStatus(admin, notification.shop);
    if (!billing.emailEntitled) return { status: "SKIPPED" };
  }

  const settings = await db.emailNotificationSettings.findUnique({
    where: { shop: notification.shop },
  });

  // The issue-email channel is snapshotted when the grant is created:
  // changing merchant settings later must not suppress a queued message after
  // Shopify's native email was disabled for that particular grant.
  if (isIssued && metadata.issuedEmailMode !== "CREDITFLOW_CUSTOM") {
    return { status: "SKIPPED" };
  }
  if (!isIssued && !settings?.expiryReminderEnabled) {
    return { status: "SKIPPED" };
  }
  if (!isIssued) {
    const configuredDays = Array.isArray(settings?.expiryReminderDays)
      ? settings.expiryReminderDays.map(Number)
      : [];
    const queuedReminderDay = Number(metadata.reminderDays);
    if (!configuredDays.includes(queuedReminderDay)) {
      return { status: "SKIPPED" };
    }
  }

  const accountGid = String(metadata.shopifyAccountGid ?? "");
  const transactionGid = String(metadata.shopifyTransactionGid ?? "");
  if (!accountGid || !transactionGid) {
    throw new Error("The notification is missing its Shopify credit references.");
  }

  const transactionNumericId = transactionGid.split("/").pop() ?? "";
  if (!/^\d+$/.test(transactionNumericId)) {
    throw new Error("The Shopify credit transaction reference is invalid.");
  }

  const context = await getShopifyNotificationContext(
    admin,
    notification.customerGid,
    accountGid,
    transactionGid,
  );

  const customer = context.data?.customer;
  const account = context.data?.storeCreditAccount;
  const store = context.data?.shop;
  if (!customer?.email || !account) {
    return { status: "SKIPPED" };
  }

  const creditTransaction = account.transactions?.edges?.[0]?.node;

  if (!creditTransaction) {
    throw new Error("The Shopify credit transaction could not be found for email verification.");
  }

  const currencyCode =
    creditTransaction.remainingAmount?.currencyCode ||
    account.balance?.currencyCode ||
    String(metadata.currencyCode || "");
  const remainingAmount = creditTransaction.remainingAmount?.amount ?? "0";
  // The Shopify transaction is authoritative. If it no longer has an expiry,
  // do not send a reminder based only on CreditFlow's stored metadata.
  const expiresAt = creditTransaction.expiresAt ?? "";

  if (!isIssued) {
    if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) {
      return { status: "SKIPPED" };
    }
    if (!(Number(remainingAmount) > 0)) {
      return { status: "SKIPPED" };
    }
  }

  const shopName = store?.name || notification.shop;
  const type = isIssued ? "issued" : "expiring";
  const email = renderCreditEmail({
    type,
    settings: settings ?? {},
    data: {
      shopName,
      customerFirstName: customer.firstName ?? "",
      creditAmount: formatMoney(String(metadata.amount ?? "0"), currencyCode),
      remainingAmount: formatMoney(String(remainingAmount), currencyCode),
      expiryDate: expiresAt
        ? formatExpiryDate(expiresAt, store?.ianaTimezone)
        : "",
      shopUrl: shopUrl(context, notification.shop),
    },
  });

  const providerMessageId = await sendWithResend({
    to: customer.email,
    from: senderAddress(shopName, settings?.senderName),
    replyTo: settings?.replyToEmail,
    subject: email.subject,
    html: email.html,
    text: email.text,
    idempotencyKey: notification.dedupeKey,
  });

  return { status: "SENT", providerMessageId };
}

export function getNotificationRetryAt(attemptCount: number, now = Date.now()) {
  return new Date(now + getWebhookRetryDelayMs(attemptCount));
}

export function shouldFailNotification(attemptCount: number) {
  return attemptCount >= MAX_WEBHOOK_ATTEMPTS;
}

export function safeEmailError(error: unknown) {
  return safeMessage(error);
}
