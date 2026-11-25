import { useState } from "react";
import type { FormEvent } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getShopMetadata } from "../services/merchant.server";

type SimulationResponse = {
  error?: string;
  simulation?: {
    rule: { id: string; name: string; enabled: boolean; archived: boolean };
    eligible: boolean;
    reason: string;
    conditions: {
      logic: string;
      matches: boolean;
      results: Array<{ index: number; field: string; operator: string; value: string; passed: boolean }>;
    };
    calculation: {
      currencyCode: string;
      orderSubtotal: string;
      eligibleSubtotal: string;
      rewardBase: string;
      rewardBaseAmount: string;
      estimatedReward: string;
      maximumReward: string | null;
    };
    previewOnly: true;
  };
};

type FormState = {
  ruleId: string;
  orderSubtotal: string;
  paymentStatus: string;
  productId: string;
  itemPrice: string;
  quantity: string;
  totalDiscount: string;
  orderTags: string;
  discountCodes: string;
  shippingCountry: string;
  includeCustomer: boolean;
  customerTags: string;
  customerOrderCount: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [rules, metadata] = await Promise.all([
    db.automationRule.findMany({
      where: { shop: session.shop, archivedAt: null },
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        enabled: true,
        trigger: true,
        rewardType: true,
        percentage: true,
        fixedAmount: true,
      },
    }),
    getShopMetadata(session.shop, () => admin.graphql(`#graphql
      query CreditFlowSimulatorShop {
        shop { name currencyCode }
      }
    `)),
  ]);

  return {
    currencyCode: metadata.currencyCode || "INR",
    rules: rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      reward: rule.rewardType === "PERCENTAGE"
        ? `${rule.percentage?.toString() ?? "0"}% cashback`
        : `${rule.fixedAmount?.toString() ?? "0"} fixed credit`,
    })),
  };
};

const initialForm = (ruleId: string): FormState => ({
  ruleId,
  orderSubtotal: "10000",
  paymentStatus: "PREPAID",
  productId: "",
  itemPrice: "10000",
  quantity: "1",
  totalDiscount: "0",
  orderTags: "",
  discountCodes: "",
  shippingCountry: "",
  includeCustomer: true,
  customerTags: "",
  customerOrderCount: "1",
});

function money(value: string, currencyCode: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}

function humanize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function AutomationSimulatorPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<SimulationResponse>();
  const [form, setForm] = useState<FormState>(() =>
    initialForm(data.rules[0]?.id ?? ""),
  );
  const result = fetcher.data?.simulation;
  const busy = fetcher.state !== "idle";

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.ruleId) return;

    fetcher.submit({
      ruleId: form.ruleId,
      sample: {
        currencyCode: data.currencyCode,
        orderSubtotal: form.orderSubtotal,
        paymentStatus: form.paymentStatus,
        lineItems: [{
          productId: form.productId,
          price: form.itemPrice,
          quantity: form.quantity,
          totalDiscount: form.totalDiscount,
        }],
        orderTags: form.orderTags,
        discountCodes: form.discountCodes,
        shippingCountry: form.shippingCountry,
        includeCustomer: form.includeCustomer,
        customerTags: form.customerTags,
        customerOrderCount: form.customerOrderCount,
      },
    }, {
      method: "POST",
      action: "/api/automation-simulator",
      encType: "application/json",
    });
  }

  return (
    <s-page heading="Automation simulator">
      <div className="cfsim">
        <style>{`
          .cfsim { --ink:#202a26; --muted:#758078; --line:#e2e8e3; color:var(--ink); display:grid; gap:18px; padding:8px 0 36px; font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
          .cfsim * { box-sizing:border-box; }
          .cfsim-intro { margin:0; color:var(--muted); font-size:13px; line-height:1.6; max-width:760px; }
          .cfsim-grid { display:grid; grid-template-columns:minmax(0,1.05fr) minmax(300px,.95fr); gap:16px; align-items:start; }
          .cfsim-card { background:#fff; border:1px solid var(--line); border-radius:12px; padding:18px; min-width:0; }
          .cfsim-card h2 { margin:0 0 5px; font-size:16px; letter-spacing:-.2px; }
          .cfsim-help { color:var(--muted); font-size:11px; line-height:1.5; margin:0 0 16px; }
          .cfsim-fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
          .cfsim-field { display:grid; gap:5px; min-width:0; }
          .cfsim-field--wide { grid-column:1/-1; }
          .cfsim label { font-size:11px; font-weight:650; color:#4c5850; }
          .cfsim input,.cfsim select { width:100%; min-height:38px; border:1px solid #d8e0da; border-radius:7px; padding:8px 10px; background:#fff; color:var(--ink); font:inherit; font-size:12px; }
          .cfsim input:focus,.cfsim select:focus { outline:2px solid #b8cec0; border-color:#739782; }
          .cfsim-check { display:flex; align-items:center; gap:8px; padding:9px 0; color:#58645c; font-size:11px; }
          .cfsim-check input { width:15px; min-height:15px; }
          .cfsim-actions { display:flex; justify-content:flex-end; margin-top:16px; }
          .cfsim-button { background:#24372d; color:white; border:0; border-radius:7px; padding:10px 15px; font-weight:650; font-size:12px; min-height:38px; cursor:pointer; }
          .cfsim-button:disabled { opacity:.55; cursor:not-allowed; }
          .cfsim-empty { border:1px dashed #ccd7cf; border-radius:10px; padding:22px; color:var(--muted); font-size:12px; line-height:1.6; background:#fafcfb; }
          .cfsim-error { padding:10px 12px; border-radius:8px; border:1px solid #efd0cb; background:#fff8f6; color:#994b3f; font-size:12px; }
          .cfsim-result-top { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:14px; }
          .cfsim-status { display:inline-flex; padding:5px 9px; border-radius:999px; font-size:10px; font-weight:750; letter-spacing:.04em; background:#edf5ef; color:#2f6946; }
          .cfsim-status--no { background:#fff2e9; color:#9c5a2d; }
          .cfsim-preview { color:#7e8981; font-size:10px; text-align:right; }
          .cfsim-reward { font-size:30px; font-weight:750; letter-spacing:-1px; margin:5px 0 2px; }
          .cfsim-sub { color:var(--muted); font-size:11px; }
          .cfsim-metrics { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; margin:16px 0; }
          .cfsim-metric { border:1px solid #e8ede9; border-radius:8px; padding:10px; }
          .cfsim-metric span { display:block; font-size:10px; color:var(--muted); margin-bottom:5px; }
          .cfsim-metric strong { font-size:13px; overflow-wrap:anywhere; }
          .cfsim-divider { border:0; border-top:1px solid #e8ede9; margin:15px 0; }
          .cfsim-condition { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:9px 0; border-bottom:1px solid #eff2ef; }
          .cfsim-condition:last-child { border-bottom:0; }
          .cfsim-condition strong { display:block; font-size:11px; margin-bottom:3px; }
          .cfsim-condition small { color:var(--muted); font-size:10px; }
          .cfsim-pass { font-size:10px; color:#2f6946; font-weight:700; white-space:nowrap; }
          .cfsim-fail { font-size:10px; color:#a64d3f; font-weight:700; white-space:nowrap; }
          .cfsim-note { background:#f7f9f7; border:1px solid #e7ece8; padding:10px 11px; border-radius:8px; font-size:10px; color:#68736b; line-height:1.5; }
          @media(max-width:760px) { .cfsim-grid { grid-template-columns:1fr; } }
          @media(max-width:480px) { .cfsim-fields { grid-template-columns:1fr; } .cfsim-field--wide { grid-column:auto; } .cfsim-card { padding:14px; } }
        `}</style>

        <div>
          <p className="cfsim-intro">
            Test a saved automation against sample order details before enabling it.
            The simulator evaluates the rule and estimates the reward without issuing Store Credit,
            creating a grant, sending an email or changing the rule.
          </p>
        </div>

        {data.rules.length === 0 ? (
          <div className="cfsim-empty">
            No available automations found. Create or restore an automation first, then return here to test it.
          </div>
        ) : (
          <div className="cfsim-grid">
            <section className="cfsim-card">
              <h2>Sample order</h2>
              <p className="cfsim-help">Use representative values from an order. Only this sample is evaluated.</p>
              <form onSubmit={submit}>
                <div className="cfsim-fields">
                  <div className="cfsim-field cfsim-field--wide">
                    <label htmlFor="cfsim-rule">Automation to test</label>
                    <select id="cfsim-rule" value={form.ruleId} onChange={(event) => update("ruleId", event.target.value)}>
                      {data.rules.map((rule) => (
                        <option key={rule.id} value={rule.id}>
                          {rule.name} · {rule.enabled ? "Active" : "Paused"} · {rule.reward}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="cfsim-field">
                    <label htmlFor="cfsim-subtotal">Order subtotal ({data.currencyCode})</label>
                    <input id="cfsim-subtotal" type="number" min="0" step="0.01" required value={form.orderSubtotal} onChange={(event) => update("orderSubtotal", event.target.value)} />
                  </div>
                  <div className="cfsim-field">
                    <label htmlFor="cfsim-payment">Payment status</label>
                    <select id="cfsim-payment" value={form.paymentStatus} onChange={(event) => update("paymentStatus", event.target.value)}>
                      <option value="PREPAID">Prepaid / Paid</option>
                      <option value="COD">Cash on delivery</option>
                      <option value="UNKNOWN">Unknown</option>
                    </select>
                  </div>

                  <div className="cfsim-field">
                    <label htmlFor="cfsim-product">Shopify product ID (optional)</label>
                    <input id="cfsim-product" inputMode="numeric" placeholder="e.g. 123456789" value={form.productId} onChange={(event) => update("productId", event.target.value)} />
                  </div>
                  <div className="cfsim-field">
                    <label htmlFor="cfsim-price">Line item unit price ({data.currencyCode})</label>
                    <input id="cfsim-price" type="number" min="0" step="0.01" required value={form.itemPrice} onChange={(event) => update("itemPrice", event.target.value)} />
                  </div>
                  <div className="cfsim-field">
                    <label htmlFor="cfsim-quantity">Item quantity</label>
                    <input id="cfsim-quantity" type="number" min="1" step="1" required value={form.quantity} onChange={(event) => update("quantity", event.target.value)} />
                  </div>
                  <div className="cfsim-field">
                    <label htmlFor="cfsim-discount">Line discount ({data.currencyCode})</label>
                    <input id="cfsim-discount" type="number" min="0" step="0.01" value={form.totalDiscount} onChange={(event) => update("totalDiscount", event.target.value)} />
                  </div>
                  <div className="cfsim-field">
                    <label htmlFor="cfsim-country">Shipping country code</label>
                    <input id="cfsim-country" maxLength={2} placeholder="IN" value={form.shippingCountry} onChange={(event) => update("shippingCountry", event.target.value.toUpperCase())} />
                  </div>
                  <div className="cfsim-field">
                    <label htmlFor="cfsim-tags">Order tags (comma separated)</label>
                    <input id="cfsim-tags" value={form.orderTags} onChange={(event) => update("orderTags", event.target.value)} placeholder="vip, campaign" />
                  </div>
                  <div className="cfsim-field">
                    <label htmlFor="cfsim-discounts">Discount codes (comma separated)</label>
                    <input id="cfsim-discounts" value={form.discountCodes} onChange={(event) => update("discountCodes", event.target.value)} placeholder="WELCOME10" />
                  </div>
                  <div className="cfsim-field cfsim-field--wide">
                    <label className="cfsim-check">
                      <input type="checkbox" checked={form.includeCustomer} onChange={(event) => update("includeCustomer", event.target.checked)} />
                      Include sample customer data for customer conditions
                    </label>
                  </div>
                  {form.includeCustomer ? (
                    <>
                      <div className="cfsim-field">
                        <label htmlFor="cfsim-customer-tags">Customer tags (comma separated)</label>
                        <input id="cfsim-customer-tags" value={form.customerTags} onChange={(event) => update("customerTags", event.target.value)} placeholder="vip, loyal" />
                      </div>
                      <div className="cfsim-field">
                        <label htmlFor="cfsim-order-count">Customer order count</label>
                        <input id="cfsim-order-count" type="number" min="0" step="1" value={form.customerOrderCount} onChange={(event) => update("customerOrderCount", event.target.value)} />
                      </div>
                    </>
                  ) : null}
                </div>
                <div className="cfsim-actions">
                  <button className="cfsim-button" type="submit" disabled={busy || !form.ruleId}>
                    {busy ? "Evaluating…" : "Test automation"}
                  </button>
                </div>
              </form>
            </section>

            <section className="cfsim-card">
              <h2>Evaluation result</h2>
              <p className="cfsim-help">The result is a preview only. It does not change balances or automation state.</p>
              {fetcher.data?.error ? (
                <div className="cfsim-error">{fetcher.data.error}</div>
              ) : result ? (
                <>
                  <div className="cfsim-result-top">
                    <div>
                      <span className={`cfsim-status ${result.eligible ? "" : "cfsim-status--no"}`}>
                        {result.eligible ? "ELIGIBLE" : "NOT ELIGIBLE"}
                      </span>
                      <div className="cfsim-reward">{money(result.calculation.estimatedReward, result.calculation.currencyCode)}</div>
                      <div className="cfsim-sub">Estimated store credit</div>
                    </div>
                    <div className="cfsim-preview">SIMULATION ONLY<br />No credit issued</div>
                  </div>

                  <div className="cfsim-note">
                    <strong>{result.rule.name}</strong> is currently {result.rule.enabled ? "active" : "paused"}.
                    {result.rule.enabled ? "" : " A paused rule can be previewed, but will not execute on live orders."}
                    <br />Reason: {humanize(result.reason)}
                  </div>

                  <div className="cfsim-metrics">
                    <div className="cfsim-metric"><span>Order subtotal</span><strong>{money(result.calculation.orderSubtotal, result.calculation.currencyCode)}</strong></div>
                    <div className="cfsim-metric"><span>Eligible item subtotal</span><strong>{money(result.calculation.eligibleSubtotal, result.calculation.currencyCode)}</strong></div>
                    <div className="cfsim-metric"><span>Reward base</span><strong>{humanize(result.calculation.rewardBase)}</strong></div>
                    <div className="cfsim-metric"><span>Amount used for reward</span><strong>{money(result.calculation.rewardBaseAmount, result.calculation.currencyCode)}</strong></div>
                  </div>

                  <hr className="cfsim-divider" />
                  <h2>Condition checks</h2>
                  <p className="cfsim-help">
                    Match {result.conditions.logic === "AND" ? "all" : "any"} condition(s).
                  </p>
                  {result.conditions.results.length === 0 ? (
                    <div className="cfsim-note">No additional conditions configured. The rule condition check passes.</div>
                  ) : result.conditions.results.map((condition) => (
                    <div className="cfsim-condition" key={condition.index}>
                      <div>
                        <strong>{humanize(condition.field)}</strong>
                        <small>{humanize(condition.operator)} · Expected: {condition.value}</small>
                      </div>
                      <span className={condition.passed ? "cfsim-pass" : "cfsim-fail"}>
                        {condition.passed ? "PASSED" : "FAILED"}
                      </span>
                    </div>
                  ))}
                </>
              ) : (
                <div className="cfsim-empty">
                  Choose an automation, enter sample order values and run the simulator to see the rule evaluation.
                </div>
              )}
            </section>
          </div>
        )}

        <div className="cfsim-note">
          <strong>Safety boundary:</strong> This tool reads the saved automation and evaluates a sample in memory.
          It does not call Shopify Store Credit APIs, create grant or ledger records, enqueue customer emails,
          or enable, pause or edit an automation.
        </div>
      </div>
    </s-page>
  );
}
