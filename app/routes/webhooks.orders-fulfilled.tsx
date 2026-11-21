import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { processFulfilledOrder } from "../services/fulfillment-reward.server";
import type { ShopifyFulfilledOrder } from "../services/fulfillment-reward.server";

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unknown fulfillment webhook processing error";
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const {
    admin,
    apiVersion,
    payload,
    session,
    shop,
    topic,
    webhookId,
  } = await authenticate.webhook(request);

  if (topic !== "ORDERS_FULFILLED") {
    return new Response("Webhook topic not handled by this endpoint.", {
      status: 200,
    });
  }

  const event = await db.webhookEvent.upsert({
    where: {
      shop_webhookId: {
        shop,
        webhookId,
      },
    },
    create: {
      shop,
      webhookId,
      topic,
      apiVersion,
      status: "RECEIVED",
    },
    update: {},
  });

  // A completed, in-flight, or manually reviewable event must not be credited twice.
  if (
    event.status === "PROCESSED" ||
    event.status === "PROCESSING" ||
    event.status === "REVIEW_REQUIRED"
  ) {
    return new Response(null, { status: 200 });
  }

  const claim = await db.webhookEvent.updateMany({
    where: {
      id: event.id,
      status: { in: ["RECEIVED", "FAILED"] },
    },
    data: {
      status: "PROCESSING",
      attemptCount: { increment: 1 },
      lastError: null,
    },
  });

  if (claim.count === 0) {
    return new Response(null, { status: 200 });
  }

  if (!session || !admin) {
    await db.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: "REVIEW_REQUIRED",
        lastError: "No active offline Shopify session was available for this fulfillment event.",
      },
    });

    return new Response(null, { status: 200 });
  }

  try {
    const result = await processFulfilledOrder({
      db,
      admin,
      shop,
      order: payload as ShopifyFulfilledOrder,
    });

    if (result.status === "REVIEW_REQUIRED") {
      await db.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: "REVIEW_REQUIRED",
          lastError: result.reason,
        },
      });

      return new Response(null, { status: 200 });
    }

    await db.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: "PROCESSED",
        processedAt: new Date(),
        lastError: null,
      },
    });

    return new Response(null, { status: 200 });
  } catch (error) {
    const message = getErrorMessage(error);

    // Store Credit mutations can succeed even if a following database write fails.
    // Mark the event for reconciliation rather than retrying and risking duplicate credit.
    await db.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: "REVIEW_REQUIRED",
        lastError: message,
      },
    });

    console.error(
      `[CreditFlow] Fulfillment event ${webhookId} for ${shop} requires review:`,
      message,
    );

    return new Response(null, { status: 200 });
  }
};
