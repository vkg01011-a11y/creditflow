import test from "node:test";
import assert from "node:assert/strict";

import {
  getWebhookRetryDelayMs,
  MAX_WEBHOOK_ATTEMPTS,
} from "../app/domain/webhook-retry.mjs";

test("uses exponential retry delays starting at 30 seconds", () => {
  assert.equal(getWebhookRetryDelayMs(1), 30_000);
  assert.equal(getWebhookRetryDelayMs(2), 60_000);
  assert.equal(getWebhookRetryDelayMs(3), 120_000);
});

test("caps retry delays at one hour", () => {
  assert.equal(getWebhookRetryDelayMs(8), 3_600_000);
  assert.equal(getWebhookRetryDelayMs(20), 3_600_000);
});

test("rejects invalid attempt counts", () => {
  assert.throws(() => getWebhookRetryDelayMs(0), RangeError);
  assert.throws(() => getWebhookRetryDelayMs(-1), RangeError);
  assert.throws(() => getWebhookRetryDelayMs(1.5), RangeError);
});

test("defines a bounded maximum number of attempts", () => {
  assert.equal(MAX_WEBHOOK_ATTEMPTS, 8);
});
