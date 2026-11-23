import db from "../db.server";
import { inspectRuntimeConfiguration } from "../domain/runtime-readiness.mjs";

export const loader = async () => {
  const runtime = inspectRuntimeConfiguration(process.env);
  let databaseReady = false;

  try {
    await db.$queryRaw`SELECT 1`;
    databaseReady = true;
  } catch {
    // Do not expose database connection details to unauthenticated probes.
    databaseReady = false;
  }

  const ready = runtime.ready && databaseReady;

  return Response.json(
    {
      status: ready ? "ready" : "not_ready",
      checks: {
        runtimeConfiguration: runtime.ready ? "ok" : "not_ready",
        database: databaseReady ? "ok" : "unavailable",
      },
    },
    {
      status: ready ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
};
