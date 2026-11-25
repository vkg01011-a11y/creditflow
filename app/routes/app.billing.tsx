import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { BILLING_PLANS, getBillingStatus, getPlanSelectionUrl } from "../services/billing.server";

function dateLabel(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function money(value: string | null, currency: string | null) {
  if (value == null) return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(amount); }
  catch { return (currency || "USD") + " " + amount.toFixed(2); }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  let billing = null;
  let billingError: string | null = null;
  try { billing = await getBillingStatus(admin, session.shop, new URL(request.url).searchParams.has("plan_handle")); }
  catch { billingError = "Shopify billing status could not be refreshed. Check Partner API credentials and permissions."; }
  return { billing, billingError, pricingUrl: getPlanSelectionUrl(session.shop), plans: Object.values(BILLING_PLANS) };
};

export default function BillingPage() {
  const data = useLoaderData<typeof loader>();
  const billing = data.billing;
  return (
    <s-page heading="Plan & usage">
      <div className="cf-billing">
        <style>{".cf-billing{display:grid;gap:18px;padding:8px 0 38px;color:#202923}.cf-billing *{box-sizing:border-box}.cf-billing-hero{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}.cf-billing-kicker{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#718078}.cf-billing-title{margin:7px 0;color:#202923;font-size:26px;letter-spacing:-.05em}.cf-billing-copy{max-width:700px;margin:0;color:#748078;font-size:12px;line-height:1.7}.cf-billing-button{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:0 14px;border-radius:8px;background:#263b30;color:white;text-decoration:none;font-size:12px;font-weight:650}.cf-billing-button:hover{background:#385646;color:white}.cf-billing-card{border:1px solid #e4eae5;border-radius:12px;background:white;padding:17px;display:grid;gap:12px}.cf-billing-card h2{margin:0;color:#2b3830;font-size:14px}.cf-billing-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.cf-billing-stat{border:1px solid #e9eeea;border-radius:9px;padding:12px;min-width:0}.cf-billing-stat span{display:block;font-size:10px;color:#7b877f}.cf-billing-stat strong{display:block;margin-top:7px;font-size:18px;color:#263b30;letter-spacing:-.03em;overflow-wrap:anywhere}.cf-billing-note{border:1px solid #e5ebe6;background:#f7faf7;border-radius:9px;padding:12px;color:#5f6d64;font-size:11px;line-height:1.65}.cf-billing-error{border:1px solid #efd8d4;background:#fff7f5;border-radius:9px;padding:12px;color:#934b40;font-size:11px;line-height:1.6}.cf-plan-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.cf-plan{border:1px solid #e4eae5;border-radius:10px;padding:14px;display:grid;gap:8px;min-width:0}.cf-plan strong{font-size:12px;color:#29372f}.cf-plan-price{font-size:20px;font-weight:700;letter-spacing:-.04em;color:#263b30}.cf-plan p{margin:0;color:#7b877f;font-size:10px;line-height:1.55}@media(max-width:900px){.cf-billing-grid,.cf-plan-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.cf-billing-grid,.cf-plan-grid{grid-template-columns:1fr}.cf-billing-title{font-size:23px}}"}</style>
        <section className="cf-billing-hero">
          <div><div className="cf-billing-kicker">Subscription overview</div><h1 className="cf-billing-title">{billing?.planName ?? "Billing unavailable"}</h1><p className="cf-billing-copy">{billing?.message ?? "Your current Shopify App Pricing subscription could not be loaded."} Shopify subscription and usage charges are billed by Shopify.</p></div>
          <a className="cf-billing-button" href={data.pricingUrl} target="_top" rel="noreferrer">View or change plan</a>
        </section>
        {data.billingError ? <div className="cf-billing-error">{data.billingError}</div> : null}
        {!billing?.configured ? <div className="cf-billing-error">Billing integration is not fully configured in this environment. Set the Partner Dashboard ID, Partner API access token, Shopify App GID, and App Events API credentials as private hosting secrets. No usage events are sent until Shopify confirms an active plan.</div> : null}
        <section className="cf-billing-card"><h2>Current billing cycle</h2><div className="cf-billing-grid">
          <div className="cf-billing-stat"><span>Plan price</span><strong>{billing?.monthlyPrice == null ? "—" : "$" + billing.monthlyPrice.toFixed(2) + "/mo"}</strong></div>
          <div className="cf-billing-stat"><span>Included orders</span><strong>{billing?.unlimited ? "Unlimited" : billing?.includedOrders?.toLocaleString() ?? "—"}</strong></div>
          <div className="cf-billing-stat"><span>Orders reported</span><strong>{billing?.usageQuantity?.toLocaleString() ?? "—"}</strong></div>
          <div className="cf-billing-stat"><span>Usage cost reported</span><strong>{money(billing?.usageCostAmount ?? null, billing?.usageCurrencyCode ?? null)}</strong></div>
        </div>
        <p className="cf-billing-copy">{billing?.isTrial ? "Free trial ends " + dateLabel(billing.trialEndsAt) + ". Trial orders are not sent as billable usage events." : "Billing cycle: " + dateLabel(billing?.cycleStart ?? null) + " to " + dateLabel(billing?.cycleEnd ?? null) + "."}{billing?.cancelAtEndOfCycle ? " Cancellation is scheduled at the end of this cycle." : ""}</p>
        {billing?.plan === "business" ? <div className="cf-billing-note">Business includes unlimited order processing. CreditFlow never submits per-order overage events for this plan.</div> : billing?.active ? <div className="cf-billing-note">Additional evaluated orders are $0.10 each after the included allowance. Shopify calculates and invoices usage using the configured meter.</div> : <div className="cf-billing-note">Starter access remains available while no subscription is active. Select the Starter plan in Shopify to enable its 100 included orders and $0.10 overage meter. Until selected, no usage charges are submitted.</div>}
        </section>
        <section className="cf-billing-card"><h2>CreditFlow plans</h2><div className="cf-plan-grid">{data.plans.map((plan) => <article className="cf-plan" key={plan.handle}><strong>{plan.name}</strong><div className="cf-plan-price">${plan.monthlyPrice.toFixed(2)}<small>/month</small></div><p>{plan.unlimited ? "Unlimited orders · no usage overage" : plan.includedOrders?.toLocaleString() + " orders included · $0.10 per additional order"}</p><p>{plan.trialDays ? "14-day free trial" : "Free forever"}</p><p>{plan.brandedEmails ? "Branded emails and expiry reminders" : "Shopify-native notifications"}</p></article>)}</div></section>
        <div className="cf-billing-note">Usage is one distinct, fully fulfilled Shopify order evaluated by CreditFlow, whether or not a reward is issued. Duplicate webhook deliveries and worker retries do not add another unit. Refunds do not erase processed usage. App Events payloads contain no customer or order details.</div>
      </div>
    </s-page>
  );
}
