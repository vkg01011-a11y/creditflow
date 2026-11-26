import { createHash } from "node:crypto";

import { buildSupportEmailText } from "../domain/support-request.mjs";

function configuredEmailAddress(value: string | undefined, name: string) {
  const configured = value?.trim() ?? "";
  const match = configured.match(/<([^<>]+)>/);
  const address = (match?.[1] ?? configured).trim();
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address)) {
    throw new Error(name + " is not configured with a valid email address.");
  }
  return address;
}

export async function sendMerchantSupportRequest({
  shop,
  request,
  submissionId,
}: {
  shop: string;
  request: { email: string; category: string; priority: string; subject: string; message: string };
  submissionId: string;
}) {
  const supportAddress = configuredEmailAddress(
    process.env.CREDITFLOW_SUPPORT_EMAIL,
    "CREDITFLOW_SUPPORT_EMAIL",
  );
  const senderAddress = configuredEmailAddress(
    process.env.CREDITFLOW_EMAIL_FROM,
    "CREDITFLOW_EMAIL_FROM",
  );
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("Transactional email delivery is not configured.");

  const idempotencyDigest = createHash("sha256")
    .update(shop + ":" + submissionId)
    .digest("hex");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
      "Idempotency-Key": "creditflow-support-" + idempotencyDigest,
      "User-Agent": "CreditFlow/1.0",
    },
    body: JSON.stringify({
      from: "CreditFlow Support <" + senderAddress + ">",
      to: [supportAddress],
      reply_to: request.email,
      subject: "[" + request.category + "] " + request.subject,
      text: buildSupportEmailText({ shop, request }),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => ({})) as {
    id?: string;
    message?: string;
    error?: { message?: string };
  };
  if (!response.ok || !result.id) {
    throw new Error("Support email provider rejected the request.");
  }

  return { providerMessageId: result.id };
}
