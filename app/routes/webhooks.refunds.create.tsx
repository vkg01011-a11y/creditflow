
import { createHash } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { normalizeRefundPayload } from "../domain/webhook-payload.mjs";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { apiVersion, payload, shop, topic, webhookId } =
    await authenticate.webhook(request);

  if (topic !== "REFUNDS_CREATE") {
    return new Response("Webhook topic not handled by this endpoint.", { status: 200 });
  }

  const normalized = normalizeRefundPayload(payload);
  const serialized = JSON.stringify(normalized);
  const payloadHash = createHash("sha256").update(serialized).digest("hex");

  await db.webhookEvent.upsert({
    where: { shop_webhookId: { shop, webhookId } },
    create: {
      shop, webhookId, topic, apiVersion, status: "RECEIVED",
      payload: normalized as Prisma.InputJsonValue, payloadHash,
    },
    update: {},
  });

  return new Response(null, { status: 200 });
};
