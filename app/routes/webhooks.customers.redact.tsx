import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { enqueueCustomerRedaction } from "../services/privacy.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, webhookId } =
    await authenticate.webhook(request);

  if (topic !== "CUSTOMERS_REDACT") {
    return new Response("Webhook topic not handled by this endpoint.", {
      status: 200,
    });
  }

  await enqueueCustomerRedaction({ shop, webhookId, payload });
  return new Response(null, { status: 200 });
};
