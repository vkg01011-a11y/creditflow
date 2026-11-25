import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import type { Prisma } from "@prisma/client";

import { authenticate } from "../shopify.server";
import db from "../db.server";

const PAGE_SIZE = 50;
const VALID_STATUSES = new Set([
  "PROCESSING", "RETRY_PENDING", "CONDITION_MISMATCH", "NOT_ELIGIBLE",
  "ISSUED", "REVIEW_REQUIRED", "FAILED", "SKIPPED",
]);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const shop = session.shop;
  const ruleId = (url.searchParams.get("ruleId") ?? "").slice(0, 100);
  const rawStatus = url.searchParams.get("status") ?? "";
  const status = VALID_STATUSES.has(rawStatus) ? rawStatus : "";
  const search = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  const cursor = (url.searchParams.get("cursor") ?? "").slice(0, 100);

  const where: Prisma.AutomationExecutionWhereInput = { shop };
  if (ruleId) where.ruleId = ruleId;
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { orderName: { contains: search, mode: "insensitive" } },
      { orderGid: { contains: search, mode: "insensitive" } },
      { ruleNameSnapshot: { contains: search, mode: "insensitive" } },
      { reason: { contains: search, mode: "insensitive" } },
    ];
  }

  const cursorOptions = cursor ? { cursor: { id: cursor }, skip: 1 } : {};
  const [rowsWithLookahead, groups, totalCount, rules] = await Promise.all([
    db.automationExecution.findMany({
      where,
      orderBy: [{ evaluatedAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      ...cursorOptions,
    }),
    db.automationExecution.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
    db.automationExecution.count({ where }),
    db.automationRule.findMany({
      where: { shop },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const hasNextPage = rowsWithLookahead.length > PAGE_SIZE;
  const rows = rowsWithLookahead.slice(0, PAGE_SIZE);
  const nextCursor = hasNextPage ? rows[rows.length - 1]?.id ?? null : null;

  return {
    rows: rows.map((row) => ({
      id: row.id,
      orderName: row.orderName,
      orderGid: row.orderGid,
      ruleId: row.ruleId,
      ruleName: row.ruleNameSnapshot,
      priority: row.rulePrioritySnapshot,
      trigger: row.trigger,
      status: row.status,
      reason: row.reason,
      conditions: row.conditions,
      orderSubtotal: row.orderSubtotal?.toString() ?? null,
      eligibleSubtotal: row.eligibleSubtotal?.toString() ?? null,
      rewardBase: row.rewardBase,
      rewardBaseAmount: row.rewardBaseAmount?.toString() ?? null,
      estimatedReward: row.estimatedReward?.toString() ?? null,
      currencyCode: row.currencyCode,
      creditGrantId: row.creditGrantId,
      grantAmount: row.grantAmount?.toString() ?? null,
      attemptCount: row.attemptCount,
      errorMessage: row.errorMessage,
      evaluatedAt: row.evaluatedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    })),
    groups: groups.map((item) => ({ status: item.status, count: item._count._all })),
    totalCount,
    rules,
    filters: { ruleId, status, search },
    hasNextPage,
    nextCursor,
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

function formatMoney(value: string | null, currencyCode: string | null) {
  if (value == null) return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  if (!currencyCode) return amount.toLocaleString();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toLocaleString()}`;
  }
}

function statusClass(status: string) {
  if (status === "ISSUED") return "cfe-status cfe-status--success";
  if (["FAILED", "REVIEW_REQUIRED"].includes(status)) return "cfe-status cfe-status--warning";
  if (["CONDITION_MISMATCH", "NOT_ELIGIBLE", "SKIPPED"].includes(status)) return "cfe-status cfe-status--muted";
  return "cfe-status";
}

type ConditionResult = {
  index?: number;
  field?: string;
  operator?: string;
  value?: string;
  passed?: boolean;
};
type ConditionSnapshot = {
  logic?: string;
  matches?: boolean;
  results?: ConditionResult[];
};

export default function AutomationHistoryPage() {
  const data = useLoaderData<typeof loader>();
  const nextQuery = new URLSearchParams();
  if (data.filters.ruleId) nextQuery.set("ruleId", data.filters.ruleId);
  if (data.filters.status) nextQuery.set("status", data.filters.status);
  if (data.filters.search) nextQuery.set("q", data.filters.search);
  if (data.nextCursor) nextQuery.set("cursor", data.nextCursor);

  const issuedCount = data.groups.find((item) => item.status === "ISSUED")?.count ?? 0;
  const reviewCount = data.groups
    .filter((item) => ["REVIEW_REQUIRED", "FAILED"].includes(item.status))
    .reduce((total, item) => total + item.count, 0);
  const noMatchCount = data.groups
    .filter((item) => ["CONDITION_MISMATCH", "NOT_ELIGIBLE"].includes(item.status))
    .reduce((total, item) => total + item.count, 0);

  return (
    <s-page heading="Automation history">
      <div className="cfe-page">
        <style>{`
          .cfe-page{display:grid;gap:17px;padding:8px 0 36px;color:#202a26;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
          .cfe-page *{box-sizing:border-box}
          .cfe-intro{margin:0;color:#6d7971;font-size:12px;line-height:1.6;max-width:900px}
          .cfe-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
          .cfe-card{background:#fff;border:1px solid #e2e8e3;border-radius:10px;padding:13px 15px;min-width:0}
          .cfe-label{color:#78827b;font-size:10px}
          .cfe-value{font-size:23px;font-weight:720;letter-spacing:-.5px;margin-top:6px}
          .cfe-filters{display:grid;grid-template-columns:minmax(170px,220px) minmax(150px,180px) minmax(180px,260px) auto;gap:9px;align-items:end;width:100%}
          .cfe-field{display:grid;gap:5px;min-width:0}
          .cfe-field label{font-size:10px;font-weight:650;color:#58645c}
          .cfe-field input,.cfe-field select{width:100%;min-height:36px;border:1px solid #dce3dd;border-radius:7px;background:#fff;color:#26332b;padding:7px 9px;font:inherit;font-size:11px}
          .cfe-button{display:inline-flex;align-items:center;justify-content:center;min-height:36px;border:1px solid #dce3dd;border-radius:7px;padding:7px 12px;background:#26372d;color:#fff;font-size:11px;font-weight:650;text-decoration:none;cursor:pointer}
          .cfe-button--quiet{background:#fff;color:#536057}
          .cfe-panel{background:#fff;border:1px solid #e2e8e3;border-radius:10px;overflow:hidden}
          .cfe-panel-head{padding:13px 15px;border-bottom:1px solid #edf1ed;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
          .cfe-panel-title{font-size:13px;font-weight:700}
          .cfe-panel-note{font-size:10px;color:#79847c;margin-top:3px}
          .cfe-scroll{overflow-x:auto}
          .cfe-table{width:100%;min-width:880px;border-collapse:collapse;font-size:11px}
          .cfe-table th{text-align:left;padding:10px 12px;color:#7b867e;background:#fafbfa;font-size:9px;text-transform:uppercase;letter-spacing:.05em}
          .cfe-table td{padding:11px 12px;border-top:1px solid #edf1ed;vertical-align:top}
          .cfe-main{font-weight:650;color:#27352d}
          .cfe-sub{font-size:10px;color:#818b83;margin-top:4px;line-height:1.45}
          .cfe-status{display:inline-flex;white-space:nowrap;padding:5px 8px;border-radius:20px;background:#eef2ef;color:#536057;font-size:9px;font-weight:750}
          .cfe-status--success{background:#e7f3eb;color:#286542}
          .cfe-status--warning{background:#fff0d9;color:#865719}
          .cfe-status--muted{background:#f1f3f1;color:#626d65}
          .cfe-detail{margin-top:7px}
          .cfe-detail summary{cursor:pointer;color:#53665a;font-size:10px;font-weight:650}
          .cfe-detail-box{margin-top:8px;padding:10px;border:1px solid #e9eee9;border-radius:8px;background:#fafcfa;white-space:normal;min-width:300px}
          .cfe-condition{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid #edf1ed}
          .cfe-condition:last-child{border-bottom:0}
          .cfe-condition strong{font-size:10px}
          .cfe-condition small{display:block;color:#7b867e;font-size:9px;margin-top:2px}
          .cfe-pass{color:#287046;font-size:9px;font-weight:750;white-space:nowrap}
          .cfe-fail{color:#a34b3c;font-size:9px;font-weight:750;white-space:nowrap}
          .cfe-empty{padding:30px;text-align:center;color:#7c877f;font-size:11px}
          .cfe-pager{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 15px;border-top:1px solid #edf1ed;font-size:10px;color:#79847c}
          .cfe-warning{margin-top:7px;color:#8a4e32;font-size:10px;line-height:1.5;max-width:360px}
          @media(max-width:850px){.cfe-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.cfe-filters{grid-template-columns:repeat(2,minmax(0,1fr))}}
          @media(max-width:480px){.cfe-filters{grid-template-columns:1fr}.cfe-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
        `}</style>

        <p className="cfe-intro">
          Review how each active automation was evaluated against fulfilled orders.
          History records condition results and reward calculations, then links them to the actual grant outcome.
          It does not control rules or change Shopify Store Credit balances.
        </p>

        <section className="cfe-grid">
          <article className="cfe-card"><div className="cfe-label">Recorded evaluations</div><div className="cfe-value">{data.totalCount}</div></article>
          <article className="cfe-card"><div className="cfe-label">Credits issued</div><div className="cfe-value">{issuedCount}</div></article>
          <article className="cfe-card"><div className="cfe-label">Conditions / eligibility missed</div><div className="cfe-value">{noMatchCount}</div></article>
          <article className="cfe-card"><div className="cfe-label">Needs attention</div><div className="cfe-value">{reviewCount}</div></article>
        </section>

        <form method="get" className="cfe-filters">
          <div className="cfe-field">
            <label htmlFor="cfe-rule">Automation</label>
            <select id="cfe-rule" name="ruleId" defaultValue={data.filters.ruleId}>
              <option value="">All automations</option>
              {data.rules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name}</option>)}
            </select>
          </div>
          <div className="cfe-field">
            <label htmlFor="cfe-status">Outcome</label>
            <select id="cfe-status" name="status" defaultValue={data.filters.status}>
              <option value="">All outcomes</option>
              {[...VALID_STATUSES].map((item) => <option key={item} value={item}>{humanize(item)}</option>)}
            </select>
          </div>
          <div className="cfe-field">
            <label htmlFor="cfe-search">Search order, rule or reason</label>
            <input id="cfe-search" name="q" defaultValue={data.filters.search} placeholder="Order #1001, VIP, etc." maxLength={120} />
          </div>
          <div style={{display:"flex",gap:7}}>
            <button className="cfe-button" type="submit">Apply filters</button>
            <a className="cfe-button cfe-button--quiet" href="/app/automation-history">Reset</a>
          </div>
        </form>

        <section className="cfe-panel">
          <div className="cfe-panel-head">
            <div>
              <div className="cfe-panel-title">Execution records</div>
              <div className="cfe-panel-note">Most recent first · {data.rows.length} shown on this page</div>
            </div>
          </div>
          {data.rows.length === 0 ? (
            <div className="cfe-empty">No execution history matches these filters. New records appear as fulfilled-order webhooks are processed.</div>
          ) : (
            <div className="cfe-scroll">
              <table className="cfe-table">
                <thead><tr><th>Order</th><th>Automation</th><th>Outcome</th><th>Estimated / issued</th><th>Evaluated</th></tr></thead>
                <tbody>
                  {data.rows.map((row) => {
                    const conditions = row.conditions as ConditionSnapshot | null;
                    const conditionResults = Array.isArray(conditions?.results) ? conditions.results : [];
                    const amount = row.grantAmount ?? row.estimatedReward;
                    return (
                      <tr key={row.id}>
                        <td>
                          <div className="cfe-main">{row.orderName || row.orderGid.split("/").pop()}</div>
                          <div className="cfe-sub">{row.attemptCount} attempt{row.attemptCount === 1 ? "" : "s"}</div>
                          <details className="cfe-detail">
                            <summary>View evaluation</summary>
                            <div className="cfe-detail-box">
                              <div className="cfe-sub">Order subtotal: {formatMoney(row.orderSubtotal, row.currencyCode)}</div>
                              <div className="cfe-sub">Eligible items: {formatMoney(row.eligibleSubtotal, row.currencyCode)}</div>
                              <div className="cfe-sub">Reward base: {row.rewardBase ? humanize(row.rewardBase) : "—"} · {formatMoney(row.rewardBaseAmount, row.currencyCode)}</div>
                              {conditionResults.length === 0 ? (
                                <div className="cfe-sub" style={{marginTop:8}}>No configured conditions were evaluated.</div>
                              ) : conditionResults.map((condition, index) => (
                                <div className="cfe-condition" key={condition.index ?? index}>
                                  <div>
                                    <strong>{humanize(condition.field || "Unknown condition")}</strong>
                                    <small>{humanize(condition.operator || "")} · Expected: {condition.value || "—"}</small>
                                  </div>
                                  <span className={condition.passed ? "cfe-pass" : "cfe-fail"}>{condition.passed ? "PASSED" : "FAILED"}</span>
                                </div>
                              ))}
                              {row.creditGrantId ? <div className="cfe-sub" style={{marginTop:8}}>Grant reference: {row.creditGrantId}</div> : null}
                              {row.errorMessage ? <div className="cfe-warning">{row.errorMessage}</div> : null}
                            </div>
                          </details>
                        </td>
                        <td>
                          <div className="cfe-main">{row.ruleName}</div>
                          <div className="cfe-sub">Priority {row.priority ?? "—"} · {humanize(row.trigger)}</div>
                        </td>
                        <td>
                          <span className={statusClass(row.status)}>{humanize(row.status)}</span>
                          <div className="cfe-sub">{humanize(row.reason)}</div>
                        </td>
                        <td>
                          <div className="cfe-main">{formatMoney(amount, row.currencyCode)}</div>
                          <div className="cfe-sub">{row.grantAmount ? "Issued" : "Estimated"}</div>
                        </td>
                        <td>
                          <div>{formatDate(row.evaluatedAt)}</div>
                          <div className="cfe-sub">{row.completedAt ? "Completed " + formatDate(row.completedAt) : "Awaiting final outcome"}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="cfe-pager">
            <span>Page size: {PAGE_SIZE}</span>
            {data.hasNextPage && data.nextCursor ? (
              <a className="cfe-button cfe-button--quiet" href={`/app/automation-history?${nextQuery.toString()}`}>Next page</a>
            ) : <span>End of available history</span>}
          </div>
        </section>
      </div>
    </s-page>
  );
}
