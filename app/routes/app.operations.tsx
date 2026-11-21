
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [webhookGroups, privacyGroups, webhookRows, privacyRows] =
    await Promise.all([
      db.webhookEvent.groupBy({
        by: ["topic", "status"],
        where: { shop },
        _count: { _all: true },
      }),
      db.privacyRequest.groupBy({
        by: ["type", "status"],
        where: { shop },
        _count: { _all: true },
      }),
      db.webhookEvent.findMany({
        where: {
          shop,
          status: { in: ["RECEIVED", "PROCESSING", "FAILED", "REVIEW_REQUIRED"] },
        },
        orderBy: { receivedAt: "desc" },
        take: 30,
        select: {
          id: true,
          webhookId: true,
          topic: true,
          status: true,
          attemptCount: true,
          lastError: true,
          receivedAt: true,
          nextAttemptAt: true,
        },
      }),
      db.privacyRequest.findMany({
        where: {
          shop,
          status: { in: ["RECEIVED", "PROCESSING", "RETRY_PENDING", "FAILED", "REVIEW_REQUIRED"] },
        },
        orderBy: { receivedAt: "desc" },
        take: 20,
        select: {
          id: true,
          webhookId: true,
          type: true,
          status: true,
          attemptCount: true,
          lastError: true,
          receivedAt: true,
          nextAttemptAt: true,
        },
      }),
    ]);

  const webhookCounts = Object.fromEntries(
    webhookGroups.map((item) => [
      item.status,
      (webhookGroups
        .filter((entry) => entry.status === item.status)
        .reduce((sum, entry) => sum + entry._count._all, 0)),
    ]),
  );

  const privacyCounts = Object.fromEntries(
    privacyGroups.map((item) => [
      item.status,
      privacyGroups
        .filter((entry) => entry.status === item.status)
        .reduce((sum, entry) => sum + entry._count._all, 0),
    ]),
  );

  const actionRequiredWebhooks = webhookRows.filter((item) =>
    item.status === "FAILED" || item.status === "REVIEW_REQUIRED",
  ).length;
  const actionRequiredPrivacy = privacyRows.filter((item) =>
    item.status === "FAILED" || item.status === "REVIEW_REQUIRED",
  ).length;

  return {
    webhookGroups: webhookGroups.map((item) => ({
      topic: item.topic,
      status: item.status,
      count: item._count._all,
    })),
    privacyGroups: privacyGroups.map((item) => ({
      type: item.type,
      status: item.status,
      count: item._count._all,
    })),
    webhookRows: webhookRows.map((item) => ({
      ...item,
      receivedAt: item.receivedAt.toISOString(),
      nextAttemptAt: item.nextAttemptAt?.toISOString() ?? null,
    })),
    privacyRows: privacyRows.map((item) => ({
      ...item,
      receivedAt: item.receivedAt.toISOString(),
      nextAttemptAt: item.nextAttemptAt?.toISOString() ?? null,
    })),
    totals: {
      webhookTotal: webhookGroups.reduce((sum, item) => sum + item._count._all, 0),
      privacyTotal: privacyGroups.reduce((sum, item) => sum + item._count._all, 0),
      webhookActionRequired: actionRequiredWebhooks,
      privacyActionRequired: actionRequiredPrivacy,
    },
    workerSecretConfigured:
      Boolean(process.env.CREDITFLOW_WORKER_SECRET) &&
      (process.env.CREDITFLOW_WORKER_SECRET?.length ?? 0) >= 32,
  };
};

function humanize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function shortId(value: string) {
  return value.length > 18 ? value.slice(0, 8) + "…" + value.slice(-6) : value;
}

function statusClass(status: string) {
  if (status === "FAILED" || status === "REVIEW_REQUIRED") return "cfo-status cfo-status--warning";
  if (status === "PROCESSED" || status === "COMPLETED") return "cfo-status cfo-status--success";
  return "cfo-status";
}

export default function OperationsPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading="Operations">
      <div className="cfo-page">
        <style>{".cfo-page{display:grid;gap:18px;padding:8px 0 36px;color:#202a26}.cfo-intro{color:#68736c;font-size:13px;line-height:1.6;margin:0;max-width:850px}.cfo-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.cfo-card{background:#fff;border:1px solid #e3e8e5;border-radius:12px;padding:15px;min-width:0}.cfo-label{color:#78827b;font-size:11px}.cfo-value{font-size:25px;font-weight:700;margin-top:7px;font-variant-numeric:tabular-nums}.cfo-panel{background:#fff;border:1px solid #e3e8e5;border-radius:12px;overflow:hidden}.cfo-panel-head{padding:15px 17px;border-bottom:1px solid #edf0ed}.cfo-panel-title{font-size:14px;font-weight:700}.cfo-panel-sub{color:#78827b;font-size:11px;margin-top:4px}.cfo-pills{display:flex;flex-wrap:wrap;gap:8px;padding:13px 16px}.cfo-pill{border:1px solid #e5e9e6;border-radius:9px;padding:8px 10px;font-size:11px;background:#fafbfa}.cfo-pill strong{font-size:13px;margin-left:6px}.cfo-scroll{overflow-x:auto}.cfo-table{width:100%;min-width:760px;border-collapse:collapse;font-size:12px}.cfo-table th{text-align:left;background:#fafbfa;color:#78827b;text-transform:uppercase;letter-spacing:.05em;font-size:10px;padding:11px 14px}.cfo-table td{padding:12px 14px;border-top:1px solid #edf0ed;vertical-align:top}.cfo-status{display:inline-flex;border-radius:20px;padding:5px 8px;background:#eef2ef;color:#4d5e53;font-size:10px;font-weight:650;white-space:nowrap}.cfo-status--warning{background:#fff2d9;color:#7b5315}.cfo-status--success{background:#e8f3ec;color:#276342}.cfo-muted{color:#78827b;font-size:11px;margin-top:4px;line-height:1.5}.cfo-error{color:#8a4e32;font-size:11px;line-height:1.5;max-width:390px}.cfo-empty{padding:24px;text-align:center;color:#78827b;font-size:12px}.cfo-notice{border:1px solid #ecdcb8;background:#fffaf0;color:#674f20;border-radius:11px;padding:13px 15px;font-size:12px;line-height:1.6}.cfo-config{border:1px solid #e3e8e5;border-radius:11px;background:#fff;padding:14px 16px;font-size:12px;line-height:1.6}@media(max-width:850px){.cfo-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}"}
        <p className="cfo-intro">
          Monitor durable webhook and privacy queues for this Shopify store.
          Failed or ambiguous financial operations are intentionally surfaced
          for reconciliation rather than repeated automatically.
        </p>

        <section className="cfo-grid">
          <article className="cfo-card">
            <div className="cfo-label">Webhook events</div>
            <div className="cfo-value">{data.totals.webhookTotal}</div>
          </article>
          <article className="cfo-card">
            <div className="cfo-label">Webhook action required</div>
            <div className="cfo-value">{data.totals.webhookActionRequired}</div>
          </article>
          <article className="cfo-card">
            <div className="cfo-label">Privacy requests</div>
            <div className="cfo-value">{data.totals.privacyTotal}</div>
          </article>
          <article className="cfo-card">
            <div className="cfo-label">Privacy action required</div>
            <div className="cfo-value">{data.totals.privacyActionRequired}</div>
          </article>
        </section>

        <section className="cfo-config">
          <strong>Worker secret:</strong>{" "}
          <span className={statusClass(data.workerSecretConfigured ? "COMPLETED" : "REVIEW_REQUIRED")}>
            {data.workerSecretConfigured ? "Configured" : "Missing or too short"}
          </span>
          <div className="cfo-muted">
            Scheduler connectivity is not observable from the app. Confirm that
            your external scheduler posts to /internal/webhook-worker every minute.
          </div>
        </section>

        <section className="cfo-panel">
          <div className="cfo-panel-head">
            <div className="cfo-panel-title">Webhook queue by topic and status</div>
            <div className="cfo-panel-sub">Counts for this store only</div>
          </div>
          {data.webhookGroups.length === 0 ? (
            <div className="cfo-empty">No webhook events recorded yet.</div>
          ) : (
            <div className="cfo-pills">
              {data.webhookGroups.map((item) => (
                <div className="cfo-pill" key={item.topic + item.status}>
                  {humanize(item.topic)} · {humanize(item.status)}
                  <strong>{item.count}</strong>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="cfo-panel">
          <div className="cfo-panel-head">
            <div className="cfo-panel-title">Webhook events requiring attention or waiting</div>
            <div className="cfo-panel-sub">Most recent 30 non-completed events</div>
          </div>
          {data.webhookRows.length === 0 ? (
            <div className="cfo-empty">No pending or failed webhook events.</div>
          ) : (
            <div className="cfo-scroll">
              <table className="cfo-table">
                <thead><tr><th>Topic</th><th>Webhook</th><th>Status</th><th>Attempts</th><th>Received</th><th>Next attempt / Error</th></tr></thead>
                <tbody>
                  {data.webhookRows.map((item) => (
                    <tr key={item.id}>
                      <td>{humanize(item.topic)}</td>
                      <td>{shortId(item.webhookId)}</td>
                      <td><span className={statusClass(item.status)}>{humanize(item.status)}</span></td>
                      <td>{item.attemptCount}</td>
                      <td>{formatDate(item.receivedAt)}</td>
                      <td>
                        {item.nextAttemptAt ? <div>{formatDate(item.nextAttemptAt)}</div> : null}
                        {item.lastError ? <div className="cfo-error">{item.lastError}</div> : null}
                        {!item.nextAttemptAt && !item.lastError ? "—" : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="cfo-panel">
          <div className="cfo-panel-head">
            <div className="cfo-panel-title">Privacy queue by type and status</div>
            <div className="cfo-panel-sub">Counts for this store only</div>
          </div>
          {data.privacyGroups.length === 0 ? (
            <div className="cfo-empty">No privacy requests recorded yet.</div>
          ) : (
            <div className="cfo-pills">
              {data.privacyGroups.map((item) => (
                <div className="cfo-pill" key={item.type + item.status}>
                  {humanize(item.type)} · {humanize(item.status)}
                  <strong>{item.count}</strong>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="cfo-panel">
          <div className="cfo-panel-head">
            <div className="cfo-panel-title">Privacy requests requiring attention</div>
            <div className="cfo-panel-sub">Customer identifiers are intentionally omitted here</div>
          </div>
          {data.privacyRows.length === 0 ? (
            <div className="cfo-empty">No pending or failed privacy requests.</div>
          ) : (
            <div className="cfo-scroll">
              <table className="cfo-table">
                <thead><tr><th>Type</th><th>Request</th><th>Status</th><th>Attempts</th><th>Received</th><th>Next attempt / Error</th></tr></thead>
                <tbody>
                  {data.privacyRows.map((item) => (
                    <tr key={item.id}>
                      <td>{humanize(item.type)}</td>
                      <td>{shortId(item.webhookId)}</td>
                      <td><span className={statusClass(item.status)}>{humanize(item.status)}</span></td>
                      <td>{item.attemptCount}</td>
                      <td>{formatDate(item.receivedAt)}</td>
                      <td>
                        {item.nextAttemptAt ? <div>{formatDate(item.nextAttemptAt)}</div> : null}
                        {item.lastError ? <div className="cfo-error">{item.lastError}</div> : null}
                        {!item.nextAttemptAt && !item.lastError ? "—" : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
