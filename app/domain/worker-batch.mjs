export const WORKER_QUEUE_NAMES = [
  "webhooks",
  "privacy",
  "notifications",
  "billingUsage",
];

const MAX_BATCH_SIZE = 10;
const DEFAULT_BATCH_SIZE = 5;

/**
 * Splits one worker invocation's total claim limit across all durable queues.
 * Remainder slots rotate once per minute so low limits do not permanently
 * favor one queue. The returned limits always sum to the bounded total.
 */
export function allocateWorkerQueueLimits(requestedLimit, now = Date.now()) {
  const parsed = Number(requestedLimit);
  const total = Number.isInteger(parsed)
    ? Math.min(MAX_BATCH_SIZE, Math.max(1, parsed))
    : DEFAULT_BATCH_SIZE;
  const base = Math.floor(total / WORKER_QUEUE_NAMES.length);
  const remainder = total % WORKER_QUEUE_NAMES.length;
  const limits = Object.fromEntries(
    WORKER_QUEUE_NAMES.map((queue) => [queue, base]),
  );
  const start = Math.floor(now / 60_000) % WORKER_QUEUE_NAMES.length;

  for (let offset = 0; offset < remainder; offset += 1) {
    const queue = WORKER_QUEUE_NAMES[(start + offset) % WORKER_QUEUE_NAMES.length];
    limits[queue] += 1;
  }

  return limits;
}
