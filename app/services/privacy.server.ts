import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import db from "../db.server";
import { sessionStorage } from "../shopify.server";
import { normalizeCustomerPrivacyPayload } from "../domain/webhook-payload.mjs";

type NormalizedCustomerPrivacyPayload = {
  customerGid: string;
  requestedOrderIds: string[];
};

type NormalizedShopPrivacyPayload = {
  shopId: string | null;
};

function stableRedactedKey(value: string, namespace: string) {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    throw new Error("SHOPIFY_API_SECRET is required for privacy-safe identifier redaction.");
  }

  return (
    "redacted:" +
    createHmac("sha256", secret)
      .update(namespace)
      .update(":")
      .update(value)
      .digest("hex")
  );
}

function redactOrderIds(orderIds: string[], shop: string) {
  return orderIds.map((orderId) => stableRedactedKey(orderId, shop));
}

function normalizeCustomerPayload(
  topic: "CUSTOMERS_DATA_REQUEST" | "CUSTOMERS_REDACT",
  payload: unknown,
): NormalizedCustomerPrivacyPayload {
  return normalizeCustomerPrivacyPayload(
    topic,
    payload,
  ) as NormalizedCustomerPrivacyPayload;
}

export async function enqueueCustomerDataRequest({
  shop,
  webhookId,
  payload,
}: {
  shop: string;
  webhookId: string;
  payload: unknown;
}) {
  const normalized = normalizeCustomerPayload(
    "CUSTOMERS_DATA_REQUEST",
    payload,
  );

  await db.privacyRequest.upsert({
    where: { shop_webhookId: { shop, webhookId } },
    create: {
      shop,
      webhookId,
      type: "CUSTOMERS_DATA_REQUEST",
      status: "RECEIVED",
      customerKey: normalized.customerGid,
      requestedOrderIds: normalized.requestedOrderIds as Prisma.InputJsonValue,
      payload: normalized as unknown as Prisma.InputJsonValue,
    },
    update: {},
  });
}

export async function enqueueCustomerRedaction({
  shop,
  webhookId,
  payload,
}: {
  shop: string;
  webhookId: string;
  payload: unknown;
}) {
  const normalized = normalizeCustomerPayload("CUSTOMERS_REDACT", payload);

  await db.privacyRequest.upsert({
    where: { shop_webhookId: { shop, webhookId } },
    create: {
      shop,
      webhookId,
      type: "CUSTOMERS_REDACT",
      status: "RECEIVED",
      customerKey: normalized.customerGid,
      requestedOrderIds: normalized.requestedOrderIds as Prisma.InputJsonValue,
      payload: normalized as unknown as Prisma.InputJsonValue,
    },
    update: {},
  });
}

export async function enqueueShopRedaction({
  shop,
  webhookId,
  payload,
}: {
  shop: string;
  webhookId: string;
  payload: unknown;
}) {
  const normalized = normalizeCustomerPrivacyPayload(
    "SHOP_REDACT",
    payload,
  ) as NormalizedShopPrivacyPayload;
  if (!normalized.shopId) {
    throw new TypeError("Shop redaction request is missing its Shopify shop ID.");
  }

  await db.privacyRequest.upsert({
    where: { shop_webhookId: { shop, webhookId } },
    create: {
      shop,
      webhookId,
      type: "SHOP_REDACT",
      status: "RECEIVED",
    },
    update: {},
  });
}

export async function processCustomerDataRequest({
  id,
  shop,
  workerId,
  payload,
}: {
  id: string;
  shop: string;
  workerId: string;
  payload: unknown;
}) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new TypeError("Customer data request payload is invalid.");
  }

  const normalized = payload as NormalizedCustomerPrivacyPayload;
  const customerGid = normalized.customerGid;

  if (
    typeof customerGid !== "string" ||
    !customerGid.startsWith("gid://shopify/Customer/")
  ) {
    throw new TypeError("Customer data request has an invalid customer ID.");
  }

  const [grants, ledgerEntries, notifications, auditLogs, webhookEvents] = await Promise.all([
    db.creditGrant.findMany({
      where: { shop, customerGid },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        orderGid: true,
        ruleId: true,
        amount: true,
        currencyCode: true,
        status: true,
        shopifyAccountGid: true,
        shopifyTransactionGid: true,
        errorMessage: true,
        issuedAt: true,
        reversedAmount: true,
        rewardBaseAmount: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    db.creditLedgerEntry.findMany({
      where: { shop, customerGid },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        orderGid: true,
        transactionType: true,
        direction: true,
        amount: true,
        currencyCode: true,
        reason: true,
        shopifyTransactionGid: true,
        expiresAt: true,
        actorType: true,
        actorId: true,
        metadata: true,
        createdAt: true,
      },
    }),
    db.notification.findMany({
      where: { shop, customerGid },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        type: true,
        status: true,
        templateKey: true,
        subject: true,
        provider: true,
        providerMessageId: true,
        attemptCount: true,
        lastError: true,
        scheduledAt: true,
        sentAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    db.auditLog.findMany({
      where: {
        shop,
        OR: [{ actorId: customerGid }, { entityId: customerGid }],
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        actorType: true,
        actorId: true,
        action: true,
        entityType: true,
        entityId: true,
        reason: true,
        metadata: true,
        createdAt: true,
      },
    }),
    db.webhookEvent.findMany({
      where: {
        shop,
        OR: [
          {
            payload: {
              path: ["customerGid"],
              equals: customerGid,
            },
          },
          ...normalized.requestedOrderIds.map((orderGid) => ({
            payload: {
              path: ["orderGid"],
              equals: orderGid,
            },
          })),
        ],
      },
      orderBy: { receivedAt: "asc" },
      select: {
        id: true,
        webhookId: true,
        topic: true,
        apiVersion: true,
        status: true,
        attemptCount: true,
        payloadHash: true,
        payload: true,
        lastError: true,
        receivedAt: true,
        processedAt: true,
        nextAttemptAt: true,
      },
    }),
  ]);

  const reversals = grants.length > 0
    ? await db.creditReversal.findMany({
        where: { shop, creditGrantId: { in: grants.map((grant) => grant.id) } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true, refundGid: true, orderGid: true,
          refundedBaseAmount: true, amount: true, currencyCode: true,
          status: true, shopifyTransactionGid: true, errorMessage: true,
          processedAt: true, createdAt: true, updatedAt: true,
        },
      })
    : [];

  const dataSnapshot = {
    generatedAt: new Date().toISOString(),
    shop,
    customerGid,
    requestedOrderIds: normalized.requestedOrderIds,
    storedDataDescription:
      "CreditFlow stores Shopify customer and order identifiers, reward grant and transaction metadata, notification metadata, audit records, amounts, currencies, statuses, and timestamps. Shopify remains the authoritative store-credit balance.",
    grants: grants.map((grant) => ({
      ...grant,
      amount: grant.amount.toString(),
      reversedAmount: grant.reversedAmount?.toString() ?? null,
      rewardBaseAmount: grant.rewardBaseAmount?.toString() ?? null,
      issuedAt: grant.issuedAt?.toISOString() ?? null,
      createdAt: grant.createdAt.toISOString(),
      updatedAt: grant.updatedAt.toISOString(),
    })),
    reversals: reversals.map((reversal) => ({
      ...reversal,
      refundedBaseAmount: reversal.refundedBaseAmount.toString(),
      amount: reversal.amount.toString(),
      processedAt: reversal.processedAt?.toISOString() ?? null,
      createdAt: reversal.createdAt.toISOString(),
      updatedAt: reversal.updatedAt.toISOString(),
    })),
    ledgerEntries: ledgerEntries.map((entry) => ({
      ...entry,
      amount: entry.amount.toString(),
      expiresAt: entry.expiresAt?.toISOString() ?? null,
      createdAt: entry.createdAt.toISOString(),
    })),
    notifications: notifications.map((notification) => ({
      ...notification,
      scheduledAt: notification.scheduledAt?.toISOString() ?? null,
      sentAt: notification.sentAt?.toISOString() ?? null,
      createdAt: notification.createdAt.toISOString(),
      updatedAt: notification.updatedAt.toISOString(),
    })),
    auditLogs: auditLogs.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
    })),
    webhookEvents: webhookEvents.map((event) => ({
      ...event,
      receivedAt: event.receivedAt.toISOString(),
      processedAt: event.processedAt?.toISOString() ?? null,
      nextAttemptAt: event.nextAttemptAt?.toISOString() ?? null,
    })),
  };

  const completed = await db.privacyRequest.updateMany({
    where: { id, shop, lockedBy: workerId, type: "CUSTOMERS_DATA_REQUEST" },
    data: {
      status: "COMPLETED",
      customerKey: customerGid,
      dataSnapshot: dataSnapshot as Prisma.InputJsonValue,
      processedAt: new Date(),
      lastError: null,
      lockedAt: null,
      lockedBy: null,
      nextAttemptAt: null,
    },
  });

  if (completed.count !== 1) {
    throw new Error("Customer data request lease was lost before export was saved.");
  }
}

export async function processCustomerRedaction({
  shop,
  webhookId,
  payload,
}: {
  shop: string;
  webhookId: string;
  payload: unknown;
}) {
  const normalized = normalizeCustomerPayload("CUSTOMERS_REDACT", payload);
  const customerGid = normalized.customerGid;
  const redactedCustomerKey = stableRedactedKey(customerGid, shop);
  const redactedOrderIds = redactOrderIds(normalized.requestedOrderIds, shop);

  await db.$transaction(async (tx) => {
    const [grants, ledgerEntries] = await Promise.all([
      tx.creditGrant.findMany({
        where: { shop, customerGid },
        select: { id: true, eventKey: true, orderGid: true },
      }),
      tx.creditLedgerEntry.findMany({
        where: { shop, customerGid },
        select: { id: true, eventKey: true, orderGid: true, actorId: true },
      }),
    ]);

    for (const grant of grants) {
      await tx.creditGrant.update({
        where: { id: grant.id },
        data: {
          customerGid: redactedCustomerKey,
          orderGid: stableRedactedKey(grant.orderGid, shop),
          eventKey: stableRedactedKey(grant.eventKey, shop),
          shopifyAccountGid: null,
          shopifyTransactionGid: null,
          errorMessage: null,
        },
      });
    }

    const reversals = grants.length > 0
      ? await tx.creditReversal.findMany({
          where: { creditGrantId: { in: grants.map((grant) => grant.id) } },
          select: { id: true, refundGid: true, orderGid: true },
        })
      : [];

    for (const reversal of reversals) {
      await tx.creditReversal.update({
        where: { id: reversal.id },
        data: {
          refundGid: stableRedactedKey(reversal.refundGid, shop),
          orderGid: stableRedactedKey(reversal.orderGid, shop),
          shopifyTransactionGid: null,
          errorMessage: null,
        },
      });
    }

    for (const entry of ledgerEntries) {
      await tx.creditLedgerEntry.update({
        where: { id: entry.id },
        data: {
          customerGid: redactedCustomerKey,
          orderGid: entry.orderGid
            ? stableRedactedKey(entry.orderGid, shop)
            : null,
          eventKey: stableRedactedKey(entry.eventKey, shop),
          actorId: entry.actorId === customerGid ? null : entry.actorId,
          shopifyTransactionGid: null,
          reason: "Customer data redacted at Shopify's request.",
          metadata: Prisma.JsonNull,
        },
      });
    }

    await tx.notification.deleteMany({ where: { shop, customerGid } });

    const customerOrderIds = Array.from(new Set([
      ...normalized.requestedOrderIds,
      ...grants.map((grant) => grant.orderGid),
    ]));

    await tx.webhookEvent.deleteMany({
      where: {
        shop,
        OR: [
          {
            payload: {
              path: ["customerGid"],
              equals: customerGid,
            },
          },
          ...customerOrderIds.map((orderGid) => ({
            payload: {
              path: ["orderGid"],
              equals: orderGid,
            },
          })),
        ],
      },
    });

    await tx.auditLog.updateMany({
      where: {
        shop,
        OR: [
          { actorId: customerGid },
          { entityId: customerGid },
        ],
      },
      data: {
        actorId: null,
        entityId: null,
        metadata: Prisma.JsonNull,
        reason: "Customer data redacted at Shopify's request.",
      },
    });

    // Keep the currently executing redaction request but remove any older
    // exports for the same customer, which contain the original identifiers.
    await tx.privacyRequest.deleteMany({
      where: {
        shop,
        customerKey: customerGid,
        webhookId: { not: webhookId },
      },
    });

    await tx.privacyRequest.update({
      where: { shop_webhookId: { shop, webhookId } },
      data: {
        status: "COMPLETED",
        customerKey: redactedCustomerKey,
        requestedOrderIds: redactedOrderIds as Prisma.InputJsonValue,
        payload: Prisma.DbNull,
        dataSnapshot: Prisma.DbNull,
        processedAt: new Date(),
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt: null,
      },
    });
  });
}

export async function processShopRedaction(shop: string) {
  const sessions = await sessionStorage.findSessionsByShop(shop);

  if (sessions.length > 0) {
    await sessionStorage.deleteSessions(
      sessions.map((session) => session.id),
    );
  }

  await db.$transaction([
    db.session.deleteMany({ where: { shop } }),
    db.privacyRequest.deleteMany({ where: { shop } }),
    db.merchant.deleteMany({ where: { shop } }),
  ]);
}

export async function getPrivacyRequestExport(
  shop: string,
  requestId: string,
) {
  return db.privacyRequest.findFirst({
    where: {
      id: requestId,
      shop,
      type: "CUSTOMERS_DATA_REQUEST",
      status: "COMPLETED",
    },
    select: {
      id: true,
      type: true,
      status: true,
      customerKey: true,
      receivedAt: true,
      processedAt: true,
      dataSnapshot: true,
    },
  });
}

export async function listPrivacyRequests(shop: string) {
  return db.privacyRequest.findMany({
    where: {
      shop,
      type: "CUSTOMERS_DATA_REQUEST",
    },
    orderBy: { receivedAt: "desc" },
    take: 100,
    select: {
      id: true,
      type: true,
      status: true,
      customerKey: true,
      receivedAt: true,
      processedAt: true,
      lastError: true,
    },
  });
}
