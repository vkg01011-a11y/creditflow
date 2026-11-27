export const MAX_WEBHOOK_ATTEMPTS = 8;

const INITIAL_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

export function getWebhookRetryDelayMs(attemptCount) {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) {
    throw new RangeError("attemptCount must be a positive integer.");
  }

  const exponentialDelay =
    INITIAL_RETRY_DELAY_MS * (2 ** Math.min(attemptCount - 1, 20));

  return Math.min(exponentialDelay, MAX_RETRY_DELAY_MS);
}
