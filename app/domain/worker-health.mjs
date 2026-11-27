export const WORKER_HEARTBEAT_STALE_AFTER_MS = 3 * 60 * 1000;

export function getWorkerHeartbeatState(run, now = Date.now()) {
  if (!run) return "NOT_SEEN";
  if (run.status === "FAILED") return "FAILED";

  const referenceTime = run.completedAt ?? run.startedAt;
  const timestamp = referenceTime instanceof Date
    ? referenceTime.getTime()
    : new Date(referenceTime).getTime();

  if (!Number.isFinite(timestamp)) return "UNKNOWN";
  if (now - timestamp > WORKER_HEARTBEAT_STALE_AFTER_MS) return "STALE";
  if (run.status === "RUNNING") return "RUNNING";
  if (run.status === "COMPLETED") return "ONLINE";

  return "UNKNOWN";
}
