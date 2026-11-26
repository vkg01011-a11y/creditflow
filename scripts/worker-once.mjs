const appUrlValue = (
  process.env.WORKER_APP_URL ||
  process.env.SHOPIFY_APP_URL ||
  ""
).trim();

const workerSecret = process.env.CREDITFLOW_WORKER_SECRET ?? "";
const batchValue = Number(process.env.WORKER_BATCH_LIMIT ?? "5");
const batchLimit = Number.isInteger(batchValue)
  ? Math.min(10, Math.max(1, batchValue))
  : 5;

if (!appUrlValue) {
  throw new Error("WORKER_APP_URL or SHOPIFY_APP_URL must be configured.");
}

if (workerSecret.trim().length < 32) {
  throw new Error("CREDITFLOW_WORKER_SECRET must contain at least 32 characters.");
}

let appUrl;
try {
  appUrl = new URL(appUrlValue);
} catch {
  throw new Error("The configured worker app URL is invalid.");
}

if (appUrl.protocol !== "https:") {
  throw new Error("The managed worker runner requires an HTTPS app URL.");
}

const endpoint = new URL("/internal/webhook-worker", appUrl);
endpoint.searchParams.set("limit", String(batchLimit));

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 55_000);

try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${workerSecret}`,
      Accept: "application/json",
    },
    signal: controller.signal,
  });

  const body = await response.json().catch(() => null);

  console.log(JSON.stringify({
    event: "creditflow.worker.run",
    timestamp: new Date().toISOString(),
    httpStatus: response.status,
    success: response.ok && body?.success === true,
    claimed: body?.claimed ?? null,
    billingUsageSent: body?.billingUsageSent ?? null,
    billingUsageSkipped: body?.billingUsageSkipped ?? null,
    billingUsageRetryPending: body?.billingUsageRetryPending ?? null,
    billingUsageReviewRequired: body?.billingUsageReviewRequired ?? null,
    webhooksProcessed: body?.webhooksProcessed ?? null,
    webhooksRetryPending: body?.webhooksRetryPending ?? null,
    webhooksReviewRequired: body?.webhooksReviewRequired ?? null,
    webhooksFailed: body?.webhooksFailed ?? null,
    refundsProcessed: body?.refundsProcessed ?? null,
    refundsRetryPending: body?.refundsRetryPending ?? null,
    refundsReviewRequired: body?.refundsReviewRequired ?? null,
    privacyProcessed: body?.privacyProcessed ?? null,
    privacyRetryPending: body?.privacyRetryPending ?? null,
    privacyFailed: body?.privacyFailed ?? null,
    notificationsProcessed: body?.notificationsProcessed ?? null,
    notificationsSkipped: body?.notificationsSkipped ?? null,
    notificationsRetryPending: body?.notificationsRetryPending ?? null,
    notificationsFailed: body?.notificationsFailed ?? null,
  }));

  if (!response.ok || body?.success !== true) {
    throw new Error(`CreditFlow worker endpoint returned HTTP ${response.status}.`);
  }
} finally {
  clearTimeout(timeout);
}
