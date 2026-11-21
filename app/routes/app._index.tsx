
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

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
    creditDeducted,
    activeAutomations,
    customerCountRows,
    recentRows,
    shopMetadata,
  ] = await Promise.all([
    db.creditLedgerEntry.aggregate({
      where: {
        shop,
        direction: "CREDIT",
        createdAt: { gte: thirtyDaysAgo },
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),

    db.creditLedgerEntry.aggregate({
      where: {
        shop,
        direction: "DEBIT",
        createdAt: { gte: thirtyDaysAgo },
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),

    db.automationRule.count({
      where: { shop, enabled: true },
    }),

    // Count distinct customers in PostgreSQL without transferring every
    // grouped customer row into the Node.js process.
    db.$queryRaw<Array<{ customerCount: bigint }>>`
      SELECT COUNT(DISTINCT "customerGid")::bigint AS "customerCount"
      FROM "CreditLedgerEntry"
      WHERE "shop" = ${shop}
    `,

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
  ]);

  return {
    storeName: shopMetadata.storeName,
    currencyCode: shopMetadata.currencyCode,

    creditAdded: creditAdded._sum.amount?.toString() ?? "0",
    creditAddedCount: creditAdded._count._all,

    creditDeducted: creditDeducted._sum.amount?.toString() ?? "0",
    creditDeductedCount: creditDeducted._count._all,

    activeAutomations,
    customersWithActivity: Number(
      customerCountRows[0]?.customerCount ?? 0,
    ),

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
  const deducted = Number(data.creditDeducted) || 0;
  const maxActivity = Math.max(added, deducted, 1);

  const addedWidth = added > 0
    ? Math.max(5, (added / maxActivity) * 100)
    : 0;

  const deductedWidth = deducted > 0
    ? Math.max(5, (deducted / maxActivity) * 100)
    : 0;

  return (
    <s-page heading="CreditFlow">
      <div className="cf-dashboard">
        <style>{`
          .cf-dashboard {
            display: grid;
            gap: 22px;
            padding: 8px 0 36px;
            color: #202223;
          }

          .cf-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            gap: 16px;
            flex-wrap: wrap;
          }

          .cf-eyebrow {
            color: #737b83;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: .09em;
          }

          .cf-title {
            font-size: 25px;
            font-weight: 720;
            letter-spacing: -.7px;
            margin: 5px 0;
          }

          .cf-subtitle {
            color: #737b83;
            font-size: 13px;
            margin: 0;
          }

          .cf-period {
            border: 1px solid #e1e5e8;
            color: #555e66;
            border-radius: 20px;
            padding: 7px 11px;
            font-size: 11px;
            background: #fff;
          }

          .cf-stats {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 13px;
          }

          .cf-card {
            background: #fff;
            border: 1px solid #e4e7e9;
            border-radius: 13px;
            padding: 17px;
            min-width: 0;
            box-shadow: 0 1px 2px rgba(0,0,0,.025);
          }

          .cf-stat-label {
            font-size: 12px;
            color: #69727a;
            margin-bottom: 13px;
          }

          .cf-stat-value {
            font-size: clamp(20px, 2vw, 27px);
            font-weight: 730;
            letter-spacing: -.8px;
            overflow-wrap: anywhere;
          }

          .cf-stat-note {
            color: #858d94;
            font-size: 11px;
            margin-top: 7px;
          }

          .cf-middle {
            display: grid;
            grid-template-columns: minmax(0, 1.25fr) minmax(260px, .75fr);
            gap: 14px;
          }

          .cf-card-heading {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            margin-bottom: 18px;
          }

          .cf-card-title {
            font-size: 14px;
            font-weight: 700;
          }

          .cf-muted {
            color: #858d94;
            font-size: 11px;
          }

          .cf-bars {
            display: grid;
            gap: 20px;
          }

          .cf-bar-row {
            display: grid;
            grid-template-columns: 105px minmax(50px, 1fr) auto;
            align-items: center;
            gap: 12px;
            font-size: 12px;
          }

          .cf-bar-track {
            height: 9px;
            border-radius: 20px;
            background: #edf0f1;
            overflow: hidden;
          }

          .cf-bar-fill {
            height: 100%;
            border-radius: 20px;
            background: #263b35;
          }

          .cf-bar-fill--debit {
            background: #8c9c95;
          }

          .cf-bar-value {
            min-width: 80px;
            text-align: right;
            font-weight: 650;
            font-variant-numeric: tabular-nums;
          }

          .cf-note {
            display: flex;
            gap: 12px;
            align-items: flex-start;
            border: 1px solid #e3e8e5;
            background: #f8faf9;
            border-radius: 11px;
            padding: 14px;
          }

          .cf-note-icon {
            width: 29px;
            height: 29px;
            flex: 0 0 29px;
            display: grid;
            place-items: center;
            background: #e8efeb;
            color: #315b49;
            border-radius: 9px;
            font-size: 15px;
          }

          .cf-note-title {
            font-size: 12px;
            font-weight: 700;
            margin-bottom: 5px;
          }

          .cf-note-text {
            color: #68716d;
            font-size: 11px;
            line-height: 1.55;
          }

          .cf-table-card {
            padding: 0;
            overflow: hidden;
          }

          .cf-table-head {
            padding: 17px 18px;
            border-bottom: 1px solid #edf0f1;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
          }

          .cf-table-wrap {
            overflow-x: auto;
          }

          .cf-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            min-width: 680px;
          }

          .cf-table th {
            background: #fafbfb;
            color: #858d94;
            text-transform: uppercase;
            letter-spacing: .055em;
            font-size: 10px;
            font-weight: 700;
            text-align: left;
            padding: 11px 18px;
            border-bottom: 1px solid #edf0f1;
          }

          .cf-table td {
            padding: 14px 18px;
            border-bottom: 1px solid #f0f2f3;
            vertical-align: middle;
          }

          .cf-table tr:last-child td {
            border-bottom: 0;
          }

          .cf-primary-cell {
            font-weight: 650;
            color: #252a2e;
          }

          .cf-secondary-cell {
            color: #858d94;
            font-size: 10px;
            margin-top: 4px;
          }

          .cf-type {
            display: inline-flex;
            padding: 5px 8px;
            border-radius: 20px;
            background: #f0f2f1;
            color: #4e5853;
            font-size: 10px;
            font-weight: 650;
            white-space: nowrap;
          }

          .cf-amount {
            font-weight: 700;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
          }

          .cf-amount--credit {
            color: #19734f;
          }

          .cf-amount--debit {
            color: #59636b;
          }

          .cf-empty {
            padding: 38px 20px;
            text-align: center;
            color: #7b848b;
            font-size: 12px;
          }

          .cf-footer-note {
            color: #858d94;
            font-size: 10px;
            line-height: 1.5;
            margin: -8px 1px 0;
          }

          @media (max-width: 1050px) {
            .cf-stats {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .cf-middle {
              grid-template-columns: 1fr;
            }
          }

          @media (max-width: 600px) {
            .cf-dashboard {
              gap: 14px;
            }

            .cf-stats {
              gap: 8px;
            }

            .cf-card {
              padding: 13px;
            }

            .cf-stat-value {
              font-size: 20px;
            }

            .cf-bar-row {
              grid-template-columns: 75px minmax(35px, 1fr);
            }

            .cf-bar-value {
              grid-column: 2;
              text-align: left;
            }

            .cf-title {
              font-size: 22px;
            }
          }
        `}</style>

        <header className="cf-header">
          <div>
            <div className="cf-eyebrow">Store overview</div>
            <h1 className="cf-title">{data.storeName}</h1>
            <p className="cf-subtitle">
              A clear picture of your store credit program.
            </p>
          </div>

          <div className="cf-period">Last 30 days</div>
        </header>

        <section className="cf-stats">
          <article className="cf-card">
            <div className="cf-stat-label">Credits added</div>
            <div className="cf-stat-value">
              {formatMoney(data.creditAdded, data.currencyCode)}
            </div>
            <div className="cf-stat-note">
              {data.creditAddedCount} ledger entries in the last 30 days
            </div>
          </article>

          <article className="cf-card">
            <div className="cf-stat-label">Credits deducted</div>
            <div className="cf-stat-value">
              {formatMoney(data.creditDeducted, data.currencyCode)}
            </div>
            <div className="cf-stat-note">
              {data.creditDeductedCount} ledger entries in the last 30 days
            </div>
          </article>

          <article className="cf-card">
            <div className="cf-stat-label">Active automations</div>
            <div className="cf-stat-value">
              {data.activeAutomations.toLocaleString()}
            </div>
            <div className="cf-stat-note">
              Enabled reward rules
            </div>
          </article>

          <article className="cf-card">
            <div className="cf-stat-label">Customers with activity</div>
            <div className="cf-stat-value">
              {data.customersWithActivity.toLocaleString()}
            </div>
            <div className="cf-stat-note">
              Unique customers in the transaction ledger
            </div>
          </article>
        </section>

        <section className="cf-middle">
          <article className="cf-card">
            <div className="cf-card-heading">
              <div className="cf-card-title">Credit activity</div>
              <div className="cf-muted">Last 30 days</div>
            </div>

            <div className="cf-bars">
              <div className="cf-bar-row">
                <span>Credits added</span>
                <div className="cf-bar-track">
                  <div
                    className="cf-bar-fill"
                    style={{ width: `${addedWidth}%` }}
                  />
                </div>
                <span className="cf-bar-value">
                  {formatMoney(data.creditAdded, data.currencyCode)}
                </span>
              </div>

              <div className="cf-bar-row">
                <span>Deducted</span>
                <div className="cf-bar-track">
                  <div
                    className="cf-bar-fill cf-bar-fill--debit"
                    style={{ width: `${deductedWidth}%` }}
                  />
                </div>
                <span className="cf-bar-value">
                  {formatMoney(data.creditDeducted, data.currencyCode)}
                </span>
              </div>
            </div>
          </article>

          <article className="cf-card">
            <div className="cf-card-heading">
              <div className="cf-card-title">Wallet balance source</div>
              <span className="cf-type">Shopify native</span>
            </div>

            <div className="cf-note">
              <div className="cf-note-icon">✓</div>
              <div>
                <div className="cf-note-title">
                  Shopify remains the source of truth
                </div>
                <div className="cf-note-text">
                  CreditFlow records transaction metadata for reporting.
                  Available customer wallet balances will be read directly
                  from Shopify rather than calculated from this ledger.
                </div>
              </div>
            </div>
          </article>
        </section>

        <section className="cf-card cf-table-card">
          <div className="cf-table-head">
            <div>
              <div className="cf-card-title">Recent transactions</div>
              <div className="cf-muted" style={{ marginTop: 4 }}>
                Latest recorded wallet activity
              </div>
            </div>
            <span className="cf-muted">
              {data.recentTransactions.length} shown
            </span>
          </div>

          {data.recentTransactions.length === 0 ? (
            <div className="cf-empty">
              No transactions recorded yet. Once CreditFlow issues or records
              store credit activity, it will appear here.
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
                    <th>Amount</th>
                  </tr>
                </thead>

                <tbody>
                  {data.recentTransactions.map((entry) => {
                    const isCredit = entry.direction === "CREDIT";

                    return (
                      <tr key={entry.id}>
                        <td>
                          <div className="cf-primary-cell">
                            {humanize(entry.transactionType)}
                          </div>
                          <div className="cf-secondary-cell">
                            {entry.reason}
                          </div>
                        </td>

                        <td>
                          {shortReference(entry.customerGid)}
                        </td>

                        <td>
                          {shortReference(entry.orderGid)}
                        </td>

                        <td>{formatDate(entry.createdAt)}</td>

                        <td
                          className={`cf-amount ${
                            isCredit
                              ? "cf-amount--credit"
                              : "cf-amount--debit"
                          }`}
                        >
                          {isCredit ? "+" : "−"}
                          {formatMoney(entry.amount, entry.currencyCode)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="cf-footer-note">
          Dashboard figures are based on CreditFlow ledger records. They do not
          represent a reconstructed Shopify wallet balance. Transaction
          history will populate as the reward and credit workflows are
          connected.
        </p>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
