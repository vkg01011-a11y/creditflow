
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [items, counts] = await Promise.all([
    db.creditReversal.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        refundGid: true,
        orderGid: true,
        refundedBaseAmount: true,
        amount: true,
        currencyCode: true,
        status: true,
        errorMessage: true,
        processedAt: true,
        createdAt: true,
      },
    }),
    db.creditReversal.groupBy({
      by: ["status"],
      where: { shop },
      _count: { _all: true },
    }),
  ]);

  return {
    items: items.map((item) => ({
      ...item,
      refundedBaseAmount: item.refundedBaseAmount.toString(),
      amount: item.amount.toString(),
      processedAt: item.processedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
    })),
    counts: Object.fromEntries(
      counts.map((item) => [item.status, item._count._all]),
    ),
  };
};

function shortReference(value: string) {
  return value.split("/").pop()?.slice(-8) ?? value.slice(-8);
}

function formatMoney(value: string, currencyCode: string) {
  const amount = Number(value);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 3,
    }).format(amount);
  } catch {
    return currencyCode + " " + amount.toLocaleString();
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function ReversalsPage() {
  const { items, counts } = useLoaderData<typeof loader>();
  const needsReview = (counts.REVIEW_REQUIRED ?? 0) + (counts.PROCESSING ?? 0);

  return (
    <s-page heading="Refund reversals">
      <div style={{ display: "grid", gap: 16, padding: "8px 0 32px" }}>
        <style>{".cfr-intro{color:#68736c;font-size:13px;line-height:1.6;max-width:820px;margin:0}.cfr-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.cfr-stat{border:1px solid #e3e8e5;border-radius:12px;background:#fff;padding:15px}.cfr-label{color:#78827b;font-size:11px}.cfr-value{font-size:24px;font-weight:700;margin-top:7px;font-variant-numeric:tabular-nums}.cfr-alert{border:1px solid #ecd9b0;background:#fffaf0;border-radius:11px;padding:13px 15px;color:#654d1c;font-size:12px;line-height:1.55}.cfr-table-wrap{overflow-x:auto;border:1px solid #e3e8e5;border-radius:12px;background:#fff}.cfr-table{width:100%;min-width:760px;border-collapse:collapse;font-size:12px}.cfr-table th{text-align:left;color:#78827b;font-size:10px;text-transform:uppercase;letter-spacing:.05em;background:#fafbfa;padding:12px 14px}.cfr-table td{border-top:1px solid #edf0ed;padding:13px 14px;vertical-align:top}.cfr-id{font-weight:650;color:#27352d}.cfr-muted{color:#78827b;margin-top:4px;font-size:11px}.cfr-status{display:inline-flex;padding:5px 8px;border-radius:20px;background:#f0f3f0;font-size:10px;font-weight:650;white-space:nowrap}.cfr-review{background:#fff1d7;color:#805515}.cfr-reversed{background:#e9f4ed;color:#256343}.cfr-empty{border:1px dashed #d9e0db;border-radius:12px;padding:30px;text-align:center;color:#78827b;background:#fff;font-size:13px}@media(max-width:850px){.cfr-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}"}
        <p className="cfr-intro">
          Refund reversals track cashback debits made against Shopify's native
          store-credit account. Partial refunds are calculated against the
          original reward basis and the cumulative amount already refunded.
        </p>

        <section className="cfr-stats">
          <article className="cfr-stat"><div className="cfr-label">Reversed</div><div className="cfr-value">{counts.REVERSED ?? 0}</div></article>
          <article className="cfr-stat"><div className="cfr-label">No debit required</div><div className="cfr-value">{counts.NO_REVERSAL ?? 0}</div></article>
          <article className="cfr-stat"><div className="cfr-label">In progress</div><div className="cfr-value">{counts.PROCESSING ?? 0}</div></article>
          <article className="cfr-stat"><div className="cfr-label">Needs review</div><div className="cfr-value">{counts.REVIEW_REQUIRED ?? 0}</div></article>
        </section>

        {needsReview > 0 ? (
          <div className="cfr-alert">
            <strong>{needsReview} reversal(s) need reconciliation.</strong>
            CreditFlow will not automatically repeat a Shopify debit when its
            outcome is uncertain or the customer has insufficient store credit.
            Check the customer's Shopify store-credit transactions before
            deciding on a manual adjustment.
          </div>
        ) : null}

        {items.length === 0 ? (
          <div className="cfr-empty">No refund reversals have been recorded yet.</div>
        ) : (
          <div className="cfr-table-wrap">
            <table className="cfr-table">
              <thead>
                <tr>
                  <th>Refund</th>
                  <th>Order</th>
                  <th>Refunded reward basis</th>
                  <th>Credit debit</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td><span className="cfr-id">…{shortReference(item.refundGid)}</span></td>
                    <td><span className="cfr-id">…{shortReference(item.orderGid)}</span></td>
                    <td>{formatMoney(item.refundedBaseAmount, item.currencyCode)}</td>
                    <td>{formatMoney(item.amount, item.currencyCode)}</td>
                    <td>
                      <span className={"cfr-status " + (item.status === "REVIEW_REQUIRED" || item.status === "PROCESSING" ? "cfr-review" : item.status === "REVERSED" ? "cfr-reversed" : "")}>
                        {item.status.replaceAll("_", " ")}
                      </span>
                      {item.errorMessage ? <div className="cfr-muted">{item.errorMessage}</div> : null}
                    </td>
                    <td>{formatDate(item.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
