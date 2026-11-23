import { randomUUID, timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import type { Prisma } from "@prisma/client";

import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { MAX_WEBHOOK_ATTEMPTS, getWebhookRetryDelayMs } from "../domain/webhook-retry.mjs";
import { processFulfilledOrder } from "../services/fulfillment-reward.server";
import type { ShopifyFulfilledOrder } from "../services/fulfillment-reward.server";
import { processRefund, type NormalizedRefundPayload } from "../services/refund-reversal.server";
import {
  processCreditEmailNotification,
  queueExpiringCreditNotifications,
  getNotificationRetryAt,
  shouldFailNotification,
  safeEmailError,
} from "../services/email-notifications.server";
import {
  processCustomerDataRequest,
  processCustomerRedaction,
  processShopRedaction,
} from "../services/privacy.server";

type WebhookJob = {
  id: string;
  shop: string;
  topic: string;
  webhookId: string;
  payload: Prisma.JsonValue | null;
  attemptCount: number;
};

type PrivacyJob = {
  id: string;
  shop: string;
  webhookId: string;
  type: "CUSTOMERS_DATA_REQUEST" | "CUSTOMERS_REDACT" | "SHOP_REDACT";
  payload: Prisma.JsonValue | null;
  attemptCount: number;
};

type NotificationJob = {
  id: string;
  shop: string;
  customerGid: string;
  dedupeKey: string;
  type: "CREDIT_ISSUED" | "CREDIT_EXPIRING";
  templateKey: string;
  metadata: Prisma.JsonValue | null;
  attemptCount: number;
};

type Counts = {
  webhooksProcessed: number;
  webhooksRetryPending: number;
  webhooksReviewRequired: number;
  webhooksFailed: number;
  refundsProcessed: number;
  refundsRetryPending: number;
  refundsReviewRequired: number;
  privacyProcessed: number;
  privacyRetryPending: number;
  privacyFailed: number;
  notificationsProcessed: number;
  notificationsSkipped: number;
  notificationsRetryPending: number;
  notificationsFailed: number;
};

const MAX_BATCH_SIZE = 10;

function isAuthorized(request: Request, secret: string) {
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from("Bearer " + secret);

  return (
    supplied.length === expected.length &&
    timingSafeEqual(supplied, expected)
  );
}

async function claimWebhookJobs(limit: number, workerId: string) {
  const sql = [
    'WITH picked AS (',
    '  SELECT "id"',
    '  FROM "WebhookEvent"',
    '  WHERE (',
    '    "status" = \'RECEIVED\'::"WebhookEventStatus"',
    '    AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())',
    '  ) OR (',
    '    "status" = \'PROCESSING\'::"WebhookEventStatus"',
    '    AND ("lockedAt" IS NULL OR "lockedAt" <= NOW() - INTERVAL \'15 minutes\')',
    '  )',
    '  ORDER BY "receivedAt" ASC',
    '  LIMIT $1',
    '  FOR UPDATE SKIP LOCKED',
    ')',
    'UPDATE "WebhookEvent" AS event',
    'SET',
    '  "status" = \'PROCESSING\'::"WebhookEventStatus",',
    '  "attemptCount" = event."attemptCount" + 1,',
    '  "lockedAt" = NOW(),',
    '  "lockedBy" = $2,',
    '  "nextAttemptAt" = NULL,',
    '  "lastError" = NULL,',
    '  "updatedAt" = NOW()',
    'FROM picked',
    'WHERE event."id" = picked."id"',
    'RETURNING event."id", event."shop", event."webhookId", event."topic", event."payload", event."attemptCount"',
  ].join("\n");

  return db.$queryRawUnsafe<WebhookJob[]>(sql, limit, workerId);
}

async function claimPrivacyJobs(limit: number, workerId: string) {
  const sql = [
    'WITH picked AS (',
    '  SELECT "id"',
    '  FROM "PrivacyRequest"',
    '  WHERE (',
    '    "status" IN (',
    '      \'RECEIVED\'::"PrivacyRequestStatus",',
    '      \'RETRY_PENDING\'::"PrivacyRequestStatus"',
    '    )',
    '    AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())',
    '  ) OR (',
    '    "status" = \'PROCESSING\'::"PrivacyRequestStatus"',
    '    AND ("lockedAt" IS NULL OR "lockedAt" <= NOW() - INTERVAL \'15 minutes\')',
    '  )',
    '  ORDER BY "receivedAt" ASC',
    '  LIMIT $1',
    '  FOR UPDATE SKIP LOCKED',
    ')',
    'UPDATE "PrivacyRequest" AS item',
    'SET',
    '  "status" = \'PROCESSING\'::"PrivacyRequestStatus",',
    '  "attemptCount" = item."attemptCount" + 1,',
    '  "lockedAt" = NOW(),',
    '  "lockedBy" = $2,',
    '  "nextAttemptAt" = NULL,',
    '  "lastError" = NULL',
    'FROM picked',
    'WHERE item."id" = picked."id"',
    'RETURNING item."id", item."shop", item."webhookId", item."type", item."payload", item."attemptCount"',
  ].join("\n");

  return db.$queryRawUnsafe<PrivacyJob[]>(sql, limit, workerId);
}

async function claimNotificationJobs(
  limit: number,
  workerId: string,
  excludedShops: string[],
) {
  const sql = [
    'WITH picked AS (',
    '  SELECT "id"',
    '  FROM "Notification"',
    '  WHERE NOT ("shop" = ANY($3::text[])) AND (',
    '    "status" = \'QUEUED\'::"NotificationStatus"',
    '    AND ("scheduledAt" IS NULL OR "scheduledAt" <= NOW())',
    '  ) OR (',
    '    "status" = \'PROCESSING\'::"NotificationStatus"',
    '    AND ("lockedAt" IS NULL OR "lockedAt" <= NOW() - INTERVAL \'15 minutes\')',
    '  )',
    '  ORDER BY "scheduledAt" ASC NULLS FIRST, "createdAt" ASC',
    '  LIMIT $1',
    '  FOR UPDATE SKIP LOCKED',
    ')',
    'UPDATE "Notification" AS item',
    'SET',
    '  "status" = \'PROCESSING\'::"NotificationStatus",',
    '  "attemptCount" = item."attemptCount" + 1,',
    '  "lockedAt" = NOW(),',
    '  "lockedBy" = $2,',
    '  "scheduledAt" = NULL,',
    '  "lastError" = NULL,',
    '  "updatedAt" = NOW()',
    'FROM picked',
    'WHERE item."id" = picked."id"',
    'RETURNING item."id", item."shop", item."customerGid", item."dedupeKey", item."type", item."templateKey", item."metadata", item."attemptCount"',
  ].join("\n");

  return db.$queryRawUnsafe<NotificationJob[]>(sql, limit, workerId, excludedShops);
}

async function updateWebhookJob(
  job: WebhookJob,
  workerId: string,
  data: {
    status: "RECEIVED" | "PROCESSED" | "REVIEW_REQUIRED" | "FAILED";
    processedAt?: Date | null;
    nextAttemptAt?: Date | null;
    lastError?: string | null;
  },
) {
  return db.webhookEvent.updateMany({
    where: {
      id: job.id,
      status: "PROCESSING",
      lockedBy: workerId,
    },
    data: {
      ...data,
      lockedAt: null,
      lockedBy: null,
    },
  });
}

async function updatePrivacyJob(
  job: PrivacyJob,
  workerId: string,
  data: {
    status: "COMPLETED" | "RETRY_PENDING" | "FAILED";
    processedAt?: Date | null;
    nextAttemptAt?: Date | null;
    lastError?: string | null;
  },
) {
  return db.privacyRequest.updateMany({
    where: {
      id: job.id,
      status: "PROCESSING",
      lockedBy: workerId,
    },
    data: {
      ...data,
      lockedAt: null,
      lockedBy: null,
    },
  });
}


async function updateNotificationJob(
  job: NotificationJob,
  workerId: string,
  data: {
    status: "QUEUED" | "SENT" | "SKIPPED" | "FAILED";
    sentAt?: Date | null;
    scheduledAt?: Date | null;
    provider?: string | null;
    providerMessageId?: string | null;
    lastError?: string | null;
  },
) {
  return db.notification.updateMany({
    where: {
      id: job.id,
      status: "PROCESSING",
      lockedBy: workerId,
    },
    data: {
      ...data,
      lockedAt: null,
      lockedBy: null,
    },
  });
}

function isConfirmedGrantStatus(status: string) {
  return ["ISSUED", "REVERSED", "PARTIALLY_REVERSED"].includes(status);
}

async function scheduleWebhookFailure(
  job: WebhookJob,
  workerId: string,
  orderGid: string,
  message: string,
  counts: Counts,
) {
  // Any reserved grant means Shopify may already have accepted the mutation.
  // Even a known rejection is surfaced for operator review; never re-issue it
  // from an automatic webhook retry.
  const grant = await db.creditGrant.findFirst({
    where: { shop: job.shop, orderGid },
    orderBy: { createdAt: "desc" },
    select: { status: true },
  });

  if (grant) {
    if (isConfirmedGrantStatus(grant.status)) {
      await updateWebhookJob(job, workerId, {
        status: "PROCESSED",
        processedAt: new Date(),
        lastError: null,
      });
      counts.webhooksProcessed += 1;
    } else {
      await updateWebhookJob(job, workerId, {
        status: "REVIEW_REQUIRED",
        lastError: message.slice(0, 2000),
      });
      counts.webhooksReviewRequired += 1;
    }
    return;
  }

  if (job.attemptCount >= MAX_WEBHOOK_ATTEMPTS) {
    await updateWebhookJob(job, workerId, {
      status: "FAILED",
      lastError: message.slice(0, 2000),
    });
    counts.webhooksFailed += 1;
    return;
  }

  await updateWebhookJob(job, workerId, {
    // RECEIVED plus nextAttemptAt is the retry queue state. Reusing the
    // existing enum avoids adding a PostgreSQL enum value during migration.
    status: "RECEIVED",
    nextAttemptAt: new Date(
      Date.now() + getWebhookRetryDelayMs(job.attemptCount),
    ),
    lastError: message.slice(0, 2000),
  });
  counts.webhooksRetryPending += 1;
}

async function processWebhookJob(
  job: WebhookJob,
  workerId: string,
  counts: Counts,
) {
  const payload = job.payload;

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    await updateWebhookJob(job, workerId, {
      status: "FAILED",
      lastError: "The queued webhook payload is missing or invalid.",
    });
    counts.webhooksFailed += 1;
    return;
  }

  if (job.topic === "REFUNDS_CREATE") {
    try {
      const { admin } = await unauthenticated.admin(job.shop);
      const result = await processRefund({
        db,
        admin,
        shop: job.shop,
        webhookId: job.webhookId,
        refund: payload as unknown as NormalizedRefundPayload,
      });

      if (result.status === "PROCESSED") {
        await updateWebhookJob(job, workerId, {
          status: "PROCESSED", processedAt: new Date(), lastError: null,
        });
        counts.refundsProcessed += 1;
      } else if (result.status === "REVIEW_REQUIRED" || job.attemptCount >= MAX_WEBHOOK_ATTEMPTS) {
        await updateWebhookJob(job, workerId, {
          status: "REVIEW_REQUIRED", lastError: result.reason.slice(0, 2000),
        });
        counts.refundsReviewRequired += 1;
      } else {
        await updateWebhookJob(job, workerId, {
          status: "RECEIVED",
          nextAttemptAt: new Date(Date.now() + getWebhookRetryDelayMs(job.attemptCount)),
          lastError: result.reason.slice(0, 2000),
        });
        counts.refundsRetryPending += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown refund processing error";
      await updateWebhookJob(job, workerId, {
        status: "REVIEW_REQUIRED", lastError: message.slice(0, 2000),
      });
      counts.refundsReviewRequired += 1;
      console.error("[CreditFlow] Refund reconciliation failed for event", job.id, message);
    }
    return;
  }

  if (job.topic !== "ORDERS_FULFILLED") {
    await updateWebhookJob(job, workerId, {
      status: "FAILED",
      lastError: "The worker received an unsupported webhook topic.",
    });
    counts.webhooksFailed += 1;
    return;
  }

  const order = payload as unknown as ShopifyFulfilledOrder;
  const orderGid = order.admin_graphql_api_id;

  if (!orderGid) {
    await updateWebhookJob(job, workerId, {
      status: "FAILED",
      lastError: "The queued order is missing its Shopify GraphQL ID.",
    });
    counts.webhooksFailed += 1;
    return;
  }

  const existingGrant = await db.creditGrant.findFirst({
    where: { shop: job.shop, orderGid },
    orderBy: { createdAt: "desc" },
    select: { status: true },
  });

  if (existingGrant) {
    if (isConfirmedGrantStatus(existingGrant.status)) {
      await updateWebhookJob(job, workerId, {
        status: "PROCESSED",
        processedAt: new Date(),
        lastError: null,
      });
      counts.webhooksProcessed += 1;
    } else {
      await updateWebhookJob(job, workerId, {
        status: "REVIEW_REQUIRED",
        lastError:
          "A previous grant has no confirmed final outcome. Reconcile it before issuing another credit.",
      });
      counts.webhooksReviewRequired += 1;
    }
    return;
  }

  try {
    // The shop value originates from Shopify's authenticated webhook,
    // not from a caller-controlled worker parameter.
    const { admin } = await unauthenticated.admin(job.shop);
    const result = await processFulfilledOrder({
      db,
      admin,
      shop: job.shop,
      order,
    });

    if (
      result.status === "REVIEW_REQUIRED" ||
      (
        result.status === "SKIPPED" &&
        result.reason === "REWARD_ALREADY_PROCESSING"
      )
    ) {
      await updateWebhookJob(job, workerId, {
        status: "REVIEW_REQUIRED",
        lastError: result.status === "REVIEW_REQUIRED"
          ? result.reason
          : "Another worker has reserved this reward. Confirm its outcome before closing this event.",
      });
      counts.webhooksReviewRequired += 1;
    } else {
      await updateWebhookJob(job, workerId, {
        status: "PROCESSED",
        processedAt: new Date(),
        lastError: null,
      });
      counts.webhooksProcessed += 1;
    }
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Unknown fulfillment processing error";

    await scheduleWebhookFailure(
      job,
      workerId,
      orderGid,
      message,
      counts,
    );

    console.error(
      "[CreditFlow] Fulfillment worker failed for event",
      job.id,
      message,
    );
  }
}

async function processNotificationJob(
  job: NotificationJob,
  workerId: string,
  counts: Counts,
) {
  try {
    const { admin } = await unauthenticated.admin(job.shop);
    const result = await processCreditEmailNotification({
      db,
      admin,
      notification: job,
    });

    if (result.status === "SKIPPED") {
      await updateNotificationJob(job, workerId, {
        status: "SKIPPED",
        provider: "shopify-resend",
        lastError: null,
      });
      counts.notificationsSkipped += 1;
      return;
    }

    await updateNotificationJob(job, workerId, {
      status: "SENT",
      sentAt: new Date(),
      provider: "resend",
      providerMessageId: result.providerMessageId ?? null,
      lastError: null,
    });
    counts.notificationsProcessed += 1;
  } catch (error) {
    const message = safeEmailError(error);

    if (shouldFailNotification(job.attemptCount)) {
      await updateNotificationJob(job, workerId, {
        status: "FAILED",
        lastError: message,
      });
      counts.notificationsFailed += 1;
    } else {
      await updateNotificationJob(job, workerId, {
        status: "QUEUED",
        scheduledAt: getNotificationRetryAt(job.attemptCount),
        lastError: message,
      });
      counts.notificationsRetryPending += 1;
    }

    console.error("[CreditFlow] Customer email delivery failed", {
      notificationId: job.id,
      shop: job.shop,
      type: job.type,
      attempt: job.attemptCount,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

async function processPrivacyJob(
  job: PrivacyJob,
  workerId: string,
  counts: Counts,
) {
  try {
    if (job.type === "CUSTOMERS_DATA_REQUEST") {
      await processCustomerDataRequest({
        id: job.id,
        shop: job.shop,
        workerId,
        payload: job.payload,
      });
    } else if (job.type === "CUSTOMERS_REDACT") {
      if (!job.payload) {
        throw new Error("Customer redaction payload is missing.");
      }

      await processCustomerRedaction({
        shop: job.shop,
        webhookId: job.webhookId,
        payload: job.payload,
      });
    } else if (job.type === "SHOP_REDACT") {
      await processShopRedaction(job.shop);
    } else {
      throw new Error("Unsupported privacy request type.");
    }

    // Customer redaction updates its queue row in the same transaction;
    // shop redaction deletes its row with the rest of the shop data.
    await updatePrivacyJob(job, workerId, {
      status: "COMPLETED",
      processedAt: new Date(),
      lastError: null,
    });
    counts.privacyProcessed += 1;
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Unknown privacy request processing error";

    if (job.attemptCount >= MAX_WEBHOOK_ATTEMPTS) {
      await updatePrivacyJob(job, workerId, {
        status: "FAILED",
        lastError: message.slice(0, 2000),
      });
      counts.privacyFailed += 1;
    } else {
      await updatePrivacyJob(job, workerId, {
        status: "RETRY_PENDING",
        nextAttemptAt: new Date(
          Date.now() + getWebhookRetryDelayMs(job.attemptCount),
        ),
        lastError: message.slice(0, 2000),
      });
      counts.privacyRetryPending += 1;
    }

    console.error(
      "[CreditFlow] Privacy worker failed for request",
      job.id,
      message,
    );
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed.", { status: 405 });
  }

  const secret = process.env.CREDITFLOW_WORKER_SECRET;
  if (!secret || secret.length < 32) {
    console.error(
      "[CreditFlow] CREDITFLOW_WORKER_SECRET is missing or too short.",
    );
    return Response.json(
      { error: "Worker endpoint is not configured." },
      { status: 503 },
    );
  }

  if (!isAuthorized(request, secret)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const requestedLimit = Number(
    new URL(request.url).searchParams.get("limit") ?? "5",
  );
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(MAX_BATCH_SIZE, Math.max(1, requestedLimit))
    : 5;

  const workerId = randomUUID();
  await db.workerRun.create({ data: { id: workerId } });

  try {
    // Never start reward processing for a shop with a pending deletion request,
    // even when that deletion job is beyond this worker's current batch limit.
    const pendingShopRedactions = await db.privacyRequest.findMany({
      where: {
        type: "SHOP_REDACT",
        status: { in: ["RECEIVED", "PROCESSING", "RETRY_PENDING", "FAILED", "REVIEW_REQUIRED"] },
      },
      select: { shop: true },
      distinct: ["shop"],
    });
    const shopsBeingRedacted = new Set(
      pendingShopRedactions.map((item) => item.shop),
    );

    // Defer all customer emails for a shop while a customer redaction is
    // pending. This is intentionally conservative: privacy takes precedence
    // over notification delivery, and redaction may delete claimed queue rows.
    const pendingCustomerRedactions = await db.privacyRequest.findMany({
      where: {
        type: "CUSTOMERS_REDACT",
        status: { in: ["RECEIVED", "PROCESSING", "RETRY_PENDING", "FAILED", "REVIEW_REQUIRED"] },
      },
      select: { shop: true },
      distinct: ["shop"],
    });
    const shopsWithCustomerRedactions = new Set(
      pendingCustomerRedactions.map((item) => item.shop),
    );
    const shopsWithPrivacyWork = [
      ...new Set([...shopsBeingRedacted, ...shopsWithCustomerRedactions]),
    ];

    try {
      await queueExpiringCreditNotifications(
        db,
        new Date(),
        shopsWithPrivacyWork,
      );
    } catch (scanError) {
      console.error("[CreditFlow] Expiry email scheduling failed", {
        errorName: scanError instanceof Error ? scanError.name : "UnknownError",
      });
    }

    const [webhookJobs, privacyJobs, notificationJobs] = await Promise.all([
      claimWebhookJobs(limit, workerId),
      claimPrivacyJobs(limit, workerId),
      claimNotificationJobs(limit, workerId, shopsWithPrivacyWork),
    ]);

    const counts: Counts = {
    webhooksProcessed: 0,
    webhooksRetryPending: 0,
    webhooksReviewRequired: 0,
    webhooksFailed: 0,
    refundsProcessed: 0,
    refundsRetryPending: 0,
    refundsReviewRequired: 0,
    privacyProcessed: 0,
    privacyRetryPending: 0,
    privacyFailed: 0,
    notificationsProcessed: 0,
    notificationsSkipped: 0,
    notificationsRetryPending: 0,
    notificationsFailed: 0,
  };

  const shopRedactionJobs = privacyJobs.filter(
    (job) => job.type === "SHOP_REDACT",
  );
  const otherPrivacyJobs = privacyJobs.filter(
    (job) => job.type !== "SHOP_REDACT",
  );

  for (const job of shopRedactionJobs) {
    await processPrivacyJob(job, workerId, counts);
  }

  for (const job of otherPrivacyJobs) {
    if (!shopsBeingRedacted.has(job.shop)) {
      await processPrivacyJob(job, workerId, counts);
    }
  }

  for (const job of webhookJobs) {
    if (!shopsBeingRedacted.has(job.shop)) {
      await processWebhookJob(job, workerId, counts);
    }
  }

  for (const job of notificationJobs) {
    if (!shopsBeingRedacted.has(job.shop)) {
      await processNotificationJob(job, workerId, counts);
    }
  }

    await db.workerRun.update({
      where: { id: workerId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });

    // Keep platform-level heartbeat records for 14 days only.
    try {
      await db.workerRun.deleteMany({
        where: {
          startedAt: { lt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        },
      });
    } catch (cleanupError) {
      console.warn(
        "[CreditFlow] Worker heartbeat retention cleanup skipped",
        cleanupError instanceof Error ? cleanupError.name : "UnknownError",
      );
    }

    return Response.json({
      success: true,
      workerId,
      claimed: webhookJobs.length + privacyJobs.length + notificationJobs.length,
      ...counts,
    });
  } catch (error) {
    try {
      await db.workerRun.updateMany({
        where: { id: workerId, status: "RUNNING" },
        data: {
          status: "FAILED",
          completedAt: new Date(),
        },
      });
    } catch {
      // The heartbeat itself may be unavailable during a database outage.
    }

    console.error("[CreditFlow] Worker invocation failed", {
      workerId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });

    return Response.json(
      { success: false, error: "Worker execution failed." },
      { status: 500 },
    );
  }
};
