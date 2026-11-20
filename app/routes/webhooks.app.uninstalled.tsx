
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  await db.$transaction(async (tx) => {
    await tx.merchant.updateMany({
      where: { shop },
      data: {
        status: "UNINSTALLED",
        uninstalledAt: new Date(),
      },
    });

    await tx.session.deleteMany({
      where: { shop },
    });
  });

  return new Response(null, { status: 200 });
};
