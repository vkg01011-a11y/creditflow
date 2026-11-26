import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";

import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { normalizeSupportRequest, SUPPORT_CATEGORIES } from "../domain/support-request.mjs";
import { sendMerchantSupportRequest } from "../services/support-email.server";

type SupportActionData = { error?: string; message?: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const supportEmail = process.env.CREDITFLOW_SUPPORT_EMAIL?.trim() ?? "";
  const providerConfigured = Boolean(
    process.env.RESEND_API_KEY && process.env.CREDITFLOW_EMAIL_FROM,
  );
  const supportAddressConfigured = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(
    supportEmail.match(/<([^<>]+)>/)?.[1]?.trim() ?? supportEmail,
  );
  const supportAddress = supportEmail.match(/<([^<>]+)>/)?.[1]?.trim() ?? supportEmail;

  return {
    supportAddressConfigured,
    supportAddress: supportAddressConfigured ? supportAddress : null,
    providerConfigured,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  // Ignore bot submissions without revealing whether the form was accepted.
  if (String(form.get("website") ?? "").trim()) {
    return Response.json({ message: "Your support request has been submitted." });
  }

  try {
    if (!process.env.CREDITFLOW_SUPPORT_EMAIL?.trim()) {
      throw new Error("CreditFlow support email is not configured for this environment.");
    }
    if (!process.env.RESEND_API_KEY || !process.env.CREDITFLOW_EMAIL_FROM) {
      throw new Error("Support email delivery is not configured for this environment.");
    }
    const requestData = normalizeSupportRequest({
      email: form.get("email"),
      category: form.get("category"),
      priority: form.get("priority"),
      subject: form.get("subject"),
      message: form.get("message"),
    });
    const submissionId = String(form.get("submissionId") ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(submissionId)) {
      throw new Error("Refresh this page and try submitting your message again.");
    }

    await sendMerchantSupportRequest({
      shop: session.shop,
      request: requestData,
      submissionId,
    });

    return Response.json({ message: "Your support request was accepted for email delivery." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit your support request.";
    if (message.includes("not configured")) {
      return Response.json({ error: message }, { status: 503 });
    }
    return Response.json({ error: message }, { status: 400 });
  }
};

export default function SupportPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<SupportActionData>();
  const [submissionId, setSubmissionId] = useState("");

  useEffect(() => {
    setSubmissionId(window.crypto.randomUUID());
  }, [fetcher.data?.message]);

  const available = data.supportAddressConfigured && data.providerConfigured;

  return (
    <s-page heading="Settings & support">
      <div className="cf-support">
        <style>{`.cf-support{display:grid;gap:18px;padding:8px 0 38px;color:#202923}.cf-support *{box-sizing:border-box}.cf-support-intro{max-width:760px;margin:0;color:#748078;font-size:13px;line-height:1.7}.cf-support-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(260px,.8fr);gap:14px;align-items:start}.cf-support-panel{display:grid;gap:13px;padding:18px;border:1px solid #e5eae6;border-radius:12px;background:#fff}.cf-support-panel h2{margin:0;color:#2b3830;font-size:15px}.cf-support-panel p{margin:0;color:#748078;font-size:12px;line-height:1.65}.cf-support-fields{display:grid;grid-template-columns:1fr 1fr;gap:11px}.cf-support-field{display:grid;gap:5px;min-width:0}.cf-support-field--full{grid-column:1/-1}.cf-support-field label{color:#465148;font-size:11px;font-weight:650}.cf-support-field input,.cf-support-field select,.cf-support-field textarea{width:100%;min-height:38px;padding:9px 10px;border:1px solid #dce3de;border-radius:7px;background:#fff;color:#29332c;font:inherit;font-size:12px}.cf-support-field textarea{min-height:140px;resize:vertical;line-height:1.55}.cf-support-hint{color:#89948c;font-size:10px;line-height:1.5}.cf-support-submit{justify-self:start;min-height:38px;padding:0 14px;border:0;border-radius:8px;background:#263b30;color:#fff;font-size:12px;font-weight:650;cursor:pointer}.cf-support-submit:disabled{opacity:.55;cursor:wait}.cf-support-alert{padding:11px 13px;border:1px solid #e4eae5;border-radius:8px;background:#f7faf7;color:#5f6d64;font-size:12px;line-height:1.55}.cf-support-alert--error{border-color:#efd8d4;background:#fff7f5;color:#934b40}.cf-support-list{display:grid;gap:11px;margin:0;padding-left:18px;color:#66736b;font-size:11px;line-height:1.6}.cf-support-mark{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:760px){.cf-support-grid{grid-template-columns:1fr}}@media(max-width:560px){.cf-support-fields{grid-template-columns:1fr}.cf-support-field--full{grid-column:auto}}`}</style>
        <p className="cf-support-intro">
          CreditFlow pairs flexible reward rules with Shopify Native Store Credit, refund-aware reversals and clear activity records. Your customers’ available credit remains in Shopify.
        </p>
        {!available ? (
          <div className="cf-support-alert cf-support-alert--error" role="status">
            {data.supportAddressConfigured
              ? "The support inbox is ready, but email delivery is not configured for this environment. Ask your app administrator to configure Resend before submitting a request."
              : "Support email is not configured for this environment. A support address will appear here when the app administrator sets CREDITFLOW_SUPPORT_EMAIL."}
          </div>
        ) : null}
        {fetcher.data?.error ? <div className="cf-support-alert cf-support-alert--error" role="alert">{fetcher.data.error}</div> : null}
        {fetcher.data?.message ? <div className="cf-support-alert" role="status">{fetcher.data.message}</div> : null}
        <div className="cf-support-grid">
          <section className="cf-support-panel">
            <h2>Contact support</h2>
            <p>Tell us what you were trying to do and what happened. Please leave out customer details, passwords and Shopify tokens.</p>
            <fetcher.Form method="post" className="cf-support-fields">
              <input type="hidden" name="submissionId" value={submissionId} />
              <label className="cf-support-mark" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
              <div className="cf-support-field">
                <label htmlFor="support-email">Your email</label>
                <input id="support-email" name="email" type="email" autoComplete="email" maxLength={254} required />
              </div>
              <div className="cf-support-field">
                <label htmlFor="support-category">Issue category</label>
                <select id="support-category" name="category" defaultValue="" required>
                  <option value="" disabled>Choose a category</option>
                  {SUPPORT_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </div>
              <div className="cf-support-field">
                <label htmlFor="support-priority">Priority</label>
                <select id="support-priority" name="priority" defaultValue="Normal">
                  <option value="Normal">Normal</option>
                  <option value="High">High</option>
                </select>
              </div>
              <div className="cf-support-field cf-support-field--full">
                <label htmlFor="support-subject">Subject</label>
                <input id="support-subject" name="subject" maxLength={150} required />
              </div>
              <div className="cf-support-field cf-support-field--full">
                <label htmlFor="support-message">Message</label>
                <textarea id="support-message" name="message" maxLength={5000} required />
                <span className="cf-support-hint">Include steps to reproduce an issue. Do not include customer data or credentials.</span>
              </div>
              <button className="cf-support-submit" type="submit" disabled={!available || !submissionId || fetcher.state !== "idle"}>
                {fetcher.state !== "idle" ? "Submitting…" : "Send support request"}
              </button>
            </fetcher.Form>
          </section>
          <aside className="cf-support-panel">
            <h2>Why merchants use CreditFlow</h2>
            <ul className="cf-support-list">
              <li>Set up cashback rules without code, then preview them before activation.</li>
              <li>Keep balances in Shopify Native Store Credit.</li>
              <li>Connect refund-aware reversals to the original reward calculation.</li>
              <li>Use branded transactional emails and expiry reminders on eligible paid plans.</li>
              <li>See processing activity, retries and items that need review.</li>
            </ul>
            <p>
              {data.supportAddress ? <>Email support at <a href={`mailto:${data.supportAddress}`}>{data.supportAddress}</a>.</> : "Email support becomes available after the app administrator configures a real support address."}
            </p>
          </aside>
        </div>
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
