import type { ActionFunctionArgs } from "react-router";
import { authenticate, sessionStorage } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, topic, shop } =
    await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const currentScopes = payload.current as string[];

  if (!Array.isArray(currentScopes)) {
    throw new Error("Invalid scopes_update webhook payload");
  }

  if (session) {
    session.scope = currentScopes.join(",");

    const stored = await sessionStorage.storeSession(session);

    if (!stored) {
      throw new Error(`Failed to update Shopify session for ${shop}`);
    }
  }

  return new Response(null, { status: 200 });
};