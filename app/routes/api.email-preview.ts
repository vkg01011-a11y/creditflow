import type { ActionFunctionArgs } from "react-router";

import db from "../db.server";
import { getShopMetadata } from "../services/merchant.server";
import { getBillingStatus } from "../services/billing.server";
import { sendCreditEmailPreview } from "../services/email-notifications.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const recipient = String(form.get("recipient") ?? "").trim();
  const type = String(form.get("type") ?? "issued");
  const submissionId = String(form.get("submissionId") ?? "");
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(recipient) || recipient.length > 254) {
    return Response.json({ error: "Enter a valid test-recipient email address." }, { status: 400 });
  }
  if (type !== "issued" && type !== "expiring") {
    return Response.json({ error: "Choose a valid preview email." }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(submissionId)) {
    return Response.json({ error: "Refresh this page and try again." }, { status: 400 });
  }

  let billing;
  try {
    billing = await getBillingStatus(admin, shop);
  } catch {
    return Response.json({ error: "CreditFlow could not verify the current plan. Save settings and try again later." }, { status: 503 });
  }
  if (!billing.emailEntitled) {
    return Response.json({ error: "Branded email previews can be sent on Professional and Business plans." }, { status: 403 });
  }
  if (!process.env.RESEND_API_KEY || !process.env.CREDITFLOW_EMAIL_FROM) {
    return Response.json({ error: "Branded email delivery is not configured in this environment." }, { status: 503 });
  }

  const settings = await db.emailNotificationSettings.findUnique({ where: { shop } });
  if (!settings) {
    return Response.json({ error: "Save your email design before sending a preview." }, { status: 409 });
  }

  try {
    const shopMetadata = await getShopMetadata(shop, () => admin.graphql(`#graphql
      query CreditFlowEmailPreviewShop {
        shop {
          name
          currencyCode
        }
      }
    `));
    if (!shopMetadata.currencyCode) {
      return Response.json({ error: "The shop currency is not available yet. Try again after shop details load." }, { status: 503 });
    }
    await sendCreditEmailPreview({
      shop,
      shopName: shopMetadata.storeName,
      currencyCode: shopMetadata.currencyCode,
      settings: settings as unknown as Record<string, unknown>,
      recipient,
      type,
      submissionId,
    });
    return Response.json({ message: "Resend accepted the preview request. Check the test inbox and spam folder." });
  } catch (error) {
    console.error("[CreditFlow] Test email preview failed", {
      shop,
      type,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json({ error: "The email provider could not accept this preview. Check the sender configuration and try again." }, { status: 502 });
  }
};
