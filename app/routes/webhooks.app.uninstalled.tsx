
import type { ActionFunctionArgs } from "react-router";

import { authenticate, sessionStorage } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  await db.merchant.updateMany({
    where: { shop },
    data: {
      status: "UNINSTALLED",
      uninstalledAt: new Date(),
    },
  });

  const sessions = await sessionStorage.findSessionsByShop(shop);

  if (sessions.length > 0) {
    await sessionStorage.deleteSessions(
      sessions.map((session) => session.id),
    );
  }

  // Retain grants, transaction metadata and audit history.
  return new Response(null, { status: 200 });
};
