import { createHash } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { normalizeFulfillmentOrder } from "../domain/webhook-payload.mjs";

export const action = async ({ request }: ActionFunctionArgs) => {
  const {
    apiVersion,
    payload,
    shop,
    topic,
    webhookId,
  } = await authenticate.webhook(request);

  if (topic !== "ORDERS_FULFILLED") {
    return new Response("Webhook topic not handled by this endpoint.", {
      status: 200,
    });
  }

  // Persist only the fields needed by the reward processor. Customer contact
  // details, addresses, and unrelated order fields are deliberately discarded.
  const normalized = normalizeFulfillmentOrder(payload);
  const serialized = JSON.stringify(normalized);
  const payloadHash = createHash("sha256").update(serialized).digest("hex");

  await db.webhookEvent.upsert({
    where: {
      shop_webhookId: { shop, webhookId },
    },
    create: {
      shop,
      webhookId,
      topic,
      apiVersion,
      status: "RECEIVED",
      payload: normalized as Prisma.InputJsonValue,
      payloadHash,
    },
    update: {},
  });

  // No Admin API call or reward processing is performed in the webhook request.
  return new Response(null, { status: 200 });
};
