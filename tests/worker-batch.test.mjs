import test from "node:test";
import assert from "node:assert/strict";

import {
  allocateWorkerQueueLimits,
  WORKER_QUEUE_NAMES,
} from "../app/domain/worker-batch.mjs";

test("queue allocations never exceed the invocation limit", () => {
  for (let limit = 1; limit <= 10; limit += 1) {
    const allocation = allocateWorkerQueueLimits(limit, 0);
    assert.equal(Object.values(allocation).reduce((sum, value) => sum + value, 0), limit);
    assert.ok(Object.values(allocation).every((value) => value >= 0));
  }
});

test("rotates the remainder across queues", () => {
  const first = allocateWorkerQueueLimits(5, 0);
  const next = allocateWorkerQueueLimits(5, 60_000);
  const firstExtra = Object.entries(first).find(([, value]) => value === 2)?.[0];
  const nextExtra = Object.entries(next).find(([, value]) => value === 2)?.[0];

  assert.equal(firstExtra, WORKER_QUEUE_NAMES[0]);
  assert.equal(nextExtra, WORKER_QUEUE_NAMES[1]);
});

test("clamps invalid and oversized limits safely", () => {
  assert.equal(Object.values(allocateWorkerQueueLimits(500)).reduce((a, b) => a + b, 0), 10);
  assert.equal(Object.values(allocateWorkerQueueLimits(0)).reduce((a, b) => a + b, 0), 1);
  assert.equal(Object.values(allocateWorkerQueueLimits("bad")).reduce((a, b) => a + b, 0), 5);
});
