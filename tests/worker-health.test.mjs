import test from "node:test";
import assert from "node:assert/strict";

import {
  getWorkerHeartbeatState,
  WORKER_HEARTBEAT_STALE_AFTER_MS,
} from "../app/domain/worker-health.mjs";

const now = Date.parse("2026-11-23T12:00:00.000Z");

test("reports no heartbeat before the first authenticated worker call", () => {
  assert.equal(getWorkerHeartbeatState(null, now), "NOT_SEEN");
});

test("reports a recent completed run as online", () => {
  assert.equal(getWorkerHeartbeatState({
    status: "COMPLETED",
    startedAt: new Date(now - 10_000),
    completedAt: new Date(now - 5_000),
  }, now), "ONLINE");
});

test("reports a recent active run as running", () => {
  assert.equal(getWorkerHeartbeatState({
    status: "RUNNING",
    startedAt: new Date(now - 10_000),
    completedAt: null,
  }, now), "RUNNING");
});

test("reports worker heartbeat stale after three minutes", () => {
  assert.equal(getWorkerHeartbeatState({
    status: "COMPLETED",
    startedAt: new Date(now - WORKER_HEARTBEAT_STALE_AFTER_MS - 1),
    completedAt: new Date(now - WORKER_HEARTBEAT_STALE_AFTER_MS - 1),
  }, now), "STALE");
});

test("reports an explicit failed invocation", () => {
  assert.equal(getWorkerHeartbeatState({
    status: "FAILED",
    startedAt: new Date(now - 1_000),
    completedAt: new Date(now),
  }, now), "FAILED");
});
