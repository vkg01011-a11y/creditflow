
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getShopMetadata } from "../services/merchant.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  );

  const [
    creditAdded,
    refundReversed,
    activeAutomations,
    recentRows,
    shopMetadata,
    ordersEvaluated,
    ordersRewarded,
    failedAutomationCount,
    webhookAttentionCount,
    grantReviewCount,
    reversalReviewCount,
    privacyAttentionCount,
    emailFailureCount,
    billingReviewCount,
  ] = await Promise.all([
    db.creditLedgerEntry.aggregate({
      where: {
        shop,
        direction: "CREDIT",
        transactionType: "CASHBACK_CREDIT",
        createdAt: { gte: thirtyDaysAgo },
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),

    db.creditLedgerEntry.aggregate({
      where: {
        shop,
        direction: "DEBIT",
        transactionType: "REWARD_REVERSAL",
        createdAt: { gte: thirtyDaysAgo },
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),

    db.automationRule.count({
      where: { shop, enabled: true, archivedAt: null },
    }),

    db.creditLedgerEntry.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        customerGid: true,
        orderGid: true,
        transactionType: true,
        direction: true,
        amount: true,
        currencyCode: true,
        reason: true,
        createdAt: true,
      },
    }),

    getShopMetadata(shop, () =>
      admin.graphql(`#graphql
        query CreditFlowDashboardShop {
          shop {
            name
            currencyCode
          }
        }
      `),
    ),
    db.automationExecution.count({
      where: { shop, evaluatedAt: { gte: thirtyDaysAgo } },
    }),
    db.automationExecution.count({
      where: { shop, evaluatedAt: { gte: thirtyDaysAgo }, status: "ISSUED" },
    }),
    db.automationExecution.count({
      where: { shop, status: { in: ["REVIEW_REQUIRED", "FAILED"] } },
    }),
    db.webhookEvent.count({
      where: { shop, status: { in: ["FAILED", "REVIEW_REQUIRED"] } },
    }),
    db.creditGrant.count({
      where: { shop, status: { in: ["FAILED", "REVIEW_REQUIRED"] } },
    }),
    db.creditReversal.count({
      where: { shop, status: "REVIEW_REQUIRED" },
    }),
    db.privacyRequest.count({
      where: { shop, status: { in: ["FAILED", "REVIEW_REQUIRED"] } },
    }),
    db.notification.count({
      where: { shop, status: "FAILED" },
    }),
    db.billingUsageEvent.count({
      where: { shop, status: "REVIEW_REQUIRED" },
    }),
  ]);

  const recordsNeedingAttention = failedAutomationCount + webhookAttentionCount +
    grantReviewCount + reversalReviewCount + privacyAttentionCount +
    emailFailureCount + billingReviewCount;

  return {
    storeName: shopMetadata.storeName,
    currencyCode: shopMetadata.currencyCode,

    creditAdded: creditAdded._sum.amount?.toString() ?? "0",
    creditAddedCount: creditAdded._count._all,

    refundReversed: refundReversed._sum.amount?.toString() ?? "0",
    refundReversedCount: refundReversed._count._all,
    ordersEvaluated,
    ordersRewarded,
    recordsNeedingAttention,

    activeAutomations,
    recentTransactions: recentRows.map((entry) => ({
      id: entry.id,
      customerGid: entry.customerGid,
      orderGid: entry.orderGid,
      transactionType: String(entry.transactionType),
      direction: String(entry.direction),
      amount: entry.amount.toString(),
      currencyCode: entry.currencyCode,
      reason: entry.reason,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
};

function formatMoney(amount: string | number, currencyCode: string | null) {
  const value = Number(amount);

  if (!Number.isFinite(value)) return "—";

  if (!currencyCode) {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
    }).format(value);
  }

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
    }).format(value);
  } catch {
    return `${currencyCode} ${value.toLocaleString()}`;
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function humanize(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortReference(value: string | null) {
  if (!value) return "—";
  const lastPart = value.split("/").pop() ?? value;
  return `…${lastPart.slice(-6)}`;
}

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();

  const added = Number(data.creditAdded) || 0;
  const reversed = Number(data.refundReversed) || 0;
  const maxActivity = Math.max(added, reversed, 1);

  const addedWidth = added > 0 ? Math.max(3, (added / maxActivity) * 100) : 0;
  const reversedWidth = reversed > 0 ? Math.max(3, (reversed / maxActivity) * 100) : 0;

  return (
    <s-page heading="CreditFlow">
      <div className="cf-dashboard cf-dashboard--refined">
        <style>{`
          .cf-dashboard--refined {
            --dash-ink: #202923;
            --dash-muted: #748078;
            --dash-line: #e5eae6;
            --dash-soft: #f7f9f7;
            display: grid;
            gap: 18px;
            padding: 8px 0 40px;
            color: var(--dash-ink);
          }

          .cf-dashboard--refined * { box-sizing: border-box; }

          .cf-overview-head {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            gap: 18px;
            flex-wrap: wrap;
            padding: 2px 0 4px;
          }

          .cf-overview-copy { min-width: 0; }
          .cf-overview-kicker {
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--dash-muted);
            font-size: 10px;
            font-weight: 650;
            letter-spacing: .09em;
            text-transform: uppercase;
          }

          .cf-overview-kicker::before {
            content: "";
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: #73927e;
          }

          .cf-overview-title {
            margin: 8px 0 5px;
            color: var(--dash-ink);
            font-size: clamp(24px, 3vw, 30px);
            font-weight: 650;
            letter-spacing: -.055em;
            line-height: 1.08;
            overflow-wrap: anywhere;
          }

          .cf-overview-subtitle {
            max-width: 660px;
            margin: 0;
            color: var(--dash-muted);
            font-size: 12px;
            line-height: 1.6;
          }

          .cf-overview-subtitle a { margin-left: 5px; color: #42674f; font-weight: 650; text-decoration: none; }
          .cf-overview-subtitle a:hover { text-decoration: underline; }

          .cf-overview-actions {
            display: flex;
            align-items: center;
            gap: 9px;
            flex-wrap: wrap;
          }

          .cf-period {
            display: inline-flex;
            align-items: center;
            min-height: 34px;
            padding: 0 11px;
            border: 1px solid var(--dash-line);
            border-radius: 8px;
            background: #fff;
            color: #637067;
            font-size: 11px;
            font-weight: 550;
            white-space: nowrap;
          }

          .cf-primary-link {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 36px;
            padding: 0 13px;
            border: 1px solid #263b30;
            border-radius: 8px;
            background: #263b30;
            color: #fff;
            font-size: 11px;
            font-weight: 620;
            text-decoration: none;
            transition: background .16s ease, border-color .16s ease;
          }

          .cf-primary-link:hover {
            background: #355344;
            border-color: #355344;
            color: #fff;
          }

          .cf-stats {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 11px;
          }

          .cf-stat-card {
            min-width: 0;
            padding: 16px 17px 15px;
            border: 1px solid var(--dash-line);
            border-radius: 11px;
            background: #fff;
            box-shadow: 0 1px 2px rgba(27, 39, 31, .025);
          }

          .cf-stat-top {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            min-height: 18px;
          }

          .cf-stat-label {
            color: var(--dash-muted);
            font-size: 11px;
            font-weight: 560;
          }

          .cf-stat-indicator {
            width: 7px;
            height: 7px;
            flex: 0 0 7px;
            border-radius: 50%;
            background: #c5cec7;
          }

          .cf-stat-indicator--credit { background: #6f947c; }
          .cf-stat-indicator--debit { background: #9ba69e; }
          .cf-stat-indicator--automation { background: #718b9a; }
          .cf-stat-indicator--customer { background: #b29a73; }

          .cf-stat-value {
            margin-top: 13px;
            color: var(--dash-ink);
            font-size: clamp(21px, 2.2vw, 27px);
            font-weight: 660;
            letter-spacing: -.05em;
            line-height: 1.1;
            overflow-wrap: anywhere;
            font-variant-numeric: tabular-nums;
          }

          .cf-stat-note {
            margin-top: 7px;
            color: #8a948d;
            font-size: 10px;
            line-height: 1.45;
          }

          .cf-overview-grid {
            display: grid;
            grid-template-columns: minmax(0, 1.25fr) minmax(280px, .75fr);
            gap: 12px;
            align-items: stretch;
          }

          .cf-panel {
            min-width: 0;
            border: 1px solid var(--dash-line);
            border-radius: 11px;
            background: #fff;
            box-shadow: 0 1px 2px rgba(27, 39, 31, .025);
          }

          .cf-panel-pad { padding: 17px; }

          .cf-panel-head {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
            margin-bottom: 19px;
          }

          .cf-panel-title {
            margin: 0;
            color: var(--dash-ink);
            font-size: 13px;
            font-weight: 640;
            letter-spacing: -.015em;
          }

          .cf-panel-description {
            margin: 4px 0 0;
            color: #89938c;
            font-size: 10px;
            line-height: 1.45;
          }

          .cf-activity-list { display: grid; gap: 17px; }

          .cf-activity-row {
            display: grid;
            grid-template-columns: 104px minmax(50px, 1fr) minmax(94px, auto);
            gap: 12px;
            align-items: center;
          }

          .cf-activity-label {
            color: #536158;
            font-size: 11px;
            font-weight: 560;
          }

          .cf-activity-track {
            height: 7px;
            overflow: hidden;
            border-radius: 20px;
            background: #eff2ef;
          }

          .cf-activity-fill {
            height: 100%;
            border-radius: inherit;
            background: #52735e;
            transition: width .35s ease;
          }

          .cf-activity-fill--debit { background: #a6b0a9; }

          .cf-activity-amount {
            color: #344139;
            font-size: 11px;
            font-weight: 630;
            text-align: right;
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
          }

          .cf-source-panel {
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            gap: 20px;
            padding: 17px;
          }

          .cf-source-badge {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            min-height: 25px;
            padding: 0 9px;
            border: 1px solid #e3eae4;
            border-radius: 20px;
            background: #f7faf7;
            color: #47624f;
            font-size: 9px;
            font-weight: 650;
            white-space: nowrap;
          }

          .cf-source-badge::before {
            content: "";
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #73927e;
          }

          .cf-source-title {
            margin: 0 0 7px;
            color: var(--dash-ink);
            font-size: 14px;
            font-weight: 640;
            letter-spacing: -.025em;
            line-height: 1.35;
          }

          .cf-source-copy {
            margin: 0;
            color: var(--dash-muted);
            font-size: 11px;
            line-height: 1.65;
          }

          .cf-source-foot {
            padding-top: 13px;
            border-top: 1px solid #edf0ed;
            color: #7b867e;
            font-size: 10px;
            line-height: 1.5;
          }

          .cf-transactions { overflow: hidden; }

          .cf-transactions-head {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            padding: 16px 17px;
            border-bottom: 1px solid #edf0ed;
          }

          .cf-transactions-count {
            color: #8a948d;
            font-size: 10px;
            white-space: nowrap;
          }

          .cf-table-wrap { overflow-x: auto; }

          .cf-table {
            width: 100%;
            min-width: 700px;
            border-collapse: collapse;
            font-size: 11px;
          }

          .cf-table th {
            padding: 10px 16px;
            border-bottom: 1px solid #edf0ed;
            background: #fafbfa;
            color: #89938c;
            font-size: 9px;
            font-weight: 650;
            text-align: left;
            text-transform: uppercase;
            letter-spacing: .07em;
            white-space: nowrap;
          }

          .cf-table td {
            padding: 12px 16px;
            border-bottom: 1px solid #f0f2f0;
            color: #59665e;
            vertical-align: middle;
          }

          .cf-table tbody tr:last-child td { border-bottom: 0; }
          .cf-table tbody tr:hover { background: #fbfcfb; }

          .cf-activity-name {
            color: #2a372f;
            font-size: 11px;
            font-weight: 620;
          }

          .cf-secondary-cell {
            margin-top: 3px;
            color: #929b94;
            font-size: 9px;
            line-height: 1.4;
          }

          .cf-reference {
            color: #69766d;
            font-size: 10px;
            font-variant-numeric: tabular-nums;
          }

          .cf-date {
            color: #79847c;
            font-size: 10px;
            white-space: nowrap;
          }

          .cf-amount {
            font-size: 11px;
            font-weight: 660;
            text-align: right;
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
          }

          .cf-amount--credit { color: #477457; }
          .cf-amount--debit { color: #737e76; }

          .cf-empty {
            padding: 38px 18px;
            color: #818c84;
            font-size: 11px;
            line-height: 1.6;
            text-align: center;
          }

          .cf-footnote {
            margin: -5px 1px 0;
            color: #929b94;
            font-size: 9px;
            line-height: 1.55;
          }

          @media (max-width: 1050px) {
            .cf-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .cf-overview-grid { grid-template-columns: 1fr; }
          }

          @media (max-width: 620px) {
            .cf-dashboard--refined { gap: 13px; }
            .cf-stats { gap: 8px; }
            .cf-stat-card { padding: 13px; }
            .cf-stat-value { font-size: 20px; }
            .cf-panel-pad, .cf-source-panel { padding: 14px; }
            .cf-overview-head { align-items: flex-start; }
            .cf-overview-actions { width: 100%; justify-content: space-between; }
            .cf-activity-row {
              grid-template-columns: 80px minmax(35px, 1fr);
              gap: 8px 10px;
            }
            .cf-activity-amount {
              grid-column: 2;
              text-align: left;
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .cf-activity-fill { transition: none; }
          }
        `}</style>

        <header className="cf-overview-head">
          <div className="cf-overview-copy">
            <div className="cf-overview-kicker">Store overview</div>
            <h1 className="cf-overview-title">{data.storeName}</h1>
            <p className="cf-overview-subtitle">
              Your store credit activity, rewards and recent ledger movements. <Link to="/app/setup">View setup guide</Link>.
            </p>
          </div>
          <div className="cf-overview-actions">
            <span className="cf-period">Last 30 days</span>
            <Link className="cf-primary-link" to="/app/automations">Manage rewards</Link>
          </div>
        </header>

        <section className="cf-stats" aria-label="Store credit overview metrics">
          <article className="cf-stat-card">
            <div className="cf-stat-top">
              <span className="cf-stat-label">Store credit issued</span>
              <span className="cf-stat-indicator cf-stat-indicator--credit" />
            </div>
            <div className="cf-stat-value">{formatMoney(data.creditAdded, data.currencyCode)}</div>
            <div className="cf-stat-note">{data.creditAddedCount.toLocaleString()} reward grants · last 30 days</div>
          </article>

          <article className="cf-stat-card">
            <div className="cf-stat-top">
              <span className="cf-stat-label">Refund reversals</span>
              <span className="cf-stat-indicator cf-stat-indicator--debit" />
            </div>
            <div className="cf-stat-value">{formatMoney(data.refundReversed, data.currencyCode)}</div>
            <div className="cf-stat-note">{data.refundReversedCount.toLocaleString()} reversal entries · last 30 days</div>
          </article>

          <article className="cf-stat-card">
            <div className="cf-stat-top"><span className="cf-stat-label">Orders evaluated</span><span className="cf-stat-indicator cf-stat-indicator--automation" /></div>
            <div className="cf-stat-value">{data.ordersEvaluated.toLocaleString()}</div>
            <div className="cf-stat-note">Fulfilled orders checked · last 30 days</div>
          </article>

          <article className="cf-stat-card">
            <div className="cf-stat-top"><span className="cf-stat-label">Orders rewarded</span><span className="cf-stat-indicator cf-stat-indicator--credit" /></div>
            <div className="cf-stat-value">{data.ordersRewarded.toLocaleString()}</div>
            <div className="cf-stat-note">Evaluations that issued Shopify Store Credit · last 30 days</div>
          </article>

          <article className="cf-stat-card">
            <div className="cf-stat-top">
              <span className="cf-stat-label">Active reward rules</span>
              <span className="cf-stat-indicator cf-stat-indicator--automation" />
            </div>
            <div className="cf-stat-value">{data.activeAutomations.toLocaleString()}</div>
            <div className="cf-stat-note">Currently enabled reward rules</div>
          </article>

          <article className="cf-stat-card">
            <div className="cf-stat-top"><span className="cf-stat-label">Records needing attention</span><span className="cf-stat-indicator cf-stat-indicator--customer" /></div>
            <div className="cf-stat-value">{data.recordsNeedingAttention.toLocaleString()}</div>
            <div className="cf-stat-note"><Link to="/app/operations">Review processing and failed jobs</Link></div>
          </article>
        </section>

        <section className="cf-overview-grid">
          <article className="cf-panel cf-panel-pad">
            <div className="cf-panel-head">
              <div>
                <h2 className="cf-panel-title">Credit movement</h2>
                <p className="cf-panel-description">Reward credit recorded versus credit reversed for refunds</p>
              </div>
              <span className="cf-transactions-count">30-day view</span>
            </div>

            <div className="cf-activity-list">
              <div className="cf-activity-row">
                <span className="cf-activity-label">Issued</span>
                <div className="cf-activity-track" role="img" aria-label={`Credits added, relative amount ${addedWidth.toFixed(0)} percent`}>
                  <div className="cf-activity-fill" style={{ width: `${addedWidth}%` }} />
                </div>
                <span className="cf-activity-amount">{formatMoney(data.creditAdded, data.currencyCode)}</span>
              </div>

              <div className="cf-activity-row">
                <span className="cf-activity-label">Reversed</span>
                <div className="cf-activity-track" role="img" aria-label={`Refund reversals, relative amount ${reversedWidth.toFixed(0)} percent`}>
                  <div className="cf-activity-fill cf-activity-fill--debit" style={{ width: `${reversedWidth}%` }} />
                </div>
                <span className="cf-activity-amount">{formatMoney(data.refundReversed, data.currencyCode)}</span>
              </div>
            </div>
          </article>

          <aside className="cf-panel cf-source-panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <h2 className="cf-panel-title">Balance authority</h2>
              <span className="cf-source-badge">Shopify native</span>
            </div>
            <div>
              <h3 className="cf-source-title">Your customers’ balances stay in Shopify.</h3>
              <p className="cf-source-copy">
                CreditFlow keeps the rules, grant metadata and transaction history in sync.
                Shopify remains the authoritative source for available store credit balances.
              </p>
            </div>
            <div className="cf-source-foot">
              Ledger totals are activity metrics, not a reconstructed wallet balance.
            </div>
          </aside>
        </section>

        <section className="cf-panel cf-transactions">
          <div className="cf-transactions-head">
            <div>
              <h2 className="cf-panel-title">Recent transactions</h2>
              <p className="cf-panel-description">Latest credit activity recorded by CreditFlow</p>
            </div>
            <span className="cf-transactions-count">{data.recentTransactions.length} of 8 records</span>
          </div>

          {data.recentTransactions.length === 0 ? (
            <div className="cf-empty">
              No transactions have been recorded yet. Credit activity will appear here as your store starts using CreditFlow.
            </div>
          ) : (
            <div className="cf-table-wrap">
              <table className="cf-table">
                <thead>
                  <tr>
                    <th>Activity</th>
                    <th>Customer</th>
                    <th>Order</th>
                    <th>Date</th>
                    <th style={{ textAlign: "right" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentTransactions.map((entry) => {
                    const isCredit = entry.direction === "CREDIT";
                    return (
                      <tr key={entry.id}>
                        <td>
                          <div className="cf-activity-name">{humanize(entry.transactionType)}</div>
                          <div className="cf-secondary-cell">{entry.reason || "—"}</div>
                        </td>
                        <td><span className="cf-reference">{shortReference(entry.customerGid)}</span></td>
                        <td><span className="cf-reference">{shortReference(entry.orderGid)}</span></td>
                        <td><span className="cf-date">{formatDate(entry.createdAt)}</span></td>
                        <td className={`cf-amount ${isCredit ? "cf-amount--credit" : "cf-amount--debit"}`}>
                          {isCredit ? "+" : "−"}{formatMoney(entry.amount, entry.currencyCode)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="cf-footnote">
          Issued and reversed totals reflect CreditFlow transaction records. They are not available balances. Redemption and expiry totals are not included because the current app records do not provide a complete Shopify transaction feed for those events. Queue attention counts are records and may refer to the same incident across more than one queue.
        </p>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
