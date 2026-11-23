import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";

type Settings = {
  issuedEmailMode: "SHOPIFY_NATIVE" | "CREDITFLOW_CUSTOM" | "DISABLED";
  expiryReminderEnabled: boolean;
  expiryReminderDays: number[];
  senderName: string;
  replyToEmail: string;
  logoUrl: string;
  accentColor: string;
  issuedSubject: string;
  issuedHeadline: string;
  issuedMessage: string;
  issuedCtaLabel: string;
  expirySubject: string;
  expiryHeadline: string;
  expiryMessage: string;
  expiryCtaLabel: string;
  footerText: string;
};

const DEFAULT_SETTINGS: Settings = {
  issuedEmailMode: "SHOPIFY_NATIVE",
  expiryReminderEnabled: false,
  expiryReminderDays: [7, 1],
  senderName: "",
  replyToEmail: "",
  logoUrl: "",
  accentColor: "#176B5B",
  issuedSubject: "A little something for your next order",
  issuedHeadline: "You've got store credit!",
  issuedMessage: "Thank you for shopping with {{ shop_name }}. We've added {{ credit_amount }} to your store credit account.",
  issuedCtaLabel: "Shop now",
  expirySubject: "Your store credit is about to expire",
  expiryHeadline: "A little reminder before it expires",
  expiryMessage: "You still have {{ remaining_amount }} in store credit. Use it before {{ expiry_date }}.",
  expiryCtaLabel: "Use my credit",
  footerText: "",
};

const STRING_LIMITS: Record<string, number> = {
  senderName: 100,
  replyToEmail: 254,
  logoUrl: 2048,
  issuedSubject: 180,
  issuedHeadline: 120,
  issuedMessage: 500,
  issuedCtaLabel: 40,
  expirySubject: 180,
  expiryHeadline: 120,
  expiryMessage: 500,
  expiryCtaLabel: 40,
  footerText: 240,
};

function safeText(form: FormData, key: string) {
  const value = String(form.get(key) ?? "").trim();
  const maximum = STRING_LIMITS[key] ?? 500;
  if (value.length > maximum) {
    throw new Error(key + " is too long.");
  }
  return value;
}

function validateLogoUrl(value: string) {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Logo URL must be a valid HTTPS URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Logo URL must use HTTPS.");
  }
  return parsed.toString();
}

function serializeSettings(settings: Awaited<ReturnType<typeof db.emailNotificationSettings.upsert>>): Settings {
  const days = Array.isArray(settings.expiryReminderDays)
    ? settings.expiryReminderDays.map(Number).filter((day) => [1, 3, 7].includes(day))
    : [7, 1];

  return {
    issuedEmailMode: settings.issuedEmailMode,
    expiryReminderEnabled: settings.expiryReminderEnabled,
    expiryReminderDays: days,
    senderName: settings.senderName ?? "",
    replyToEmail: settings.replyToEmail ?? "",
    logoUrl: settings.logoUrl ?? "",
    accentColor: settings.accentColor,
    issuedSubject: settings.issuedSubject,
    issuedHeadline: settings.issuedHeadline,
    issuedMessage: settings.issuedMessage,
    issuedCtaLabel: settings.issuedCtaLabel,
    expirySubject: settings.expirySubject,
    expiryHeadline: settings.expiryHeadline,
    expiryMessage: settings.expiryMessage,
    expiryCtaLabel: settings.expiryCtaLabel,
    footerText: settings.footerText ?? "",
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const stored = await db.emailNotificationSettings.upsert({
    where: { shop },
    create: { shop },
    update: {},
  });

  return {
    shop,
    settings: serializeSettings(stored),
    emailProviderConfigured: Boolean(
      process.env.RESEND_API_KEY && process.env.CREDITFLOW_EMAIL_FROM,
    ),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();

  try {
    const issuedEmailMode = String(form.get("issuedEmailMode") ?? "");
    if (!["SHOPIFY_NATIVE", "CREDITFLOW_CUSTOM", "DISABLED"].includes(issuedEmailMode)) {
      throw new Error("Select a valid credit-issued email mode.");
    }

    const expiryReminderEnabled = form.get("expiryReminderEnabled") === "true";
    const expiryReminderDays = [...new Set(
      form.getAll("expiryReminderDays")
        .map((value) => Number(value))
        .filter((day) => [1, 3, 7].includes(day)),
    )].sort((a, b) => b - a);

    if (expiryReminderEnabled && expiryReminderDays.length === 0) {
      throw new Error("Select at least one expiry reminder time.");
    }

    const senderName = safeText(form, "senderName");
    const replyToEmail = safeText(form, "replyToEmail");
    if (replyToEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyToEmail)) {
      throw new Error("Enter a valid reply-to email address.");
    }

    const accentColor = String(form.get("accentColor") ?? "");
    if (!/^#[0-9a-f]{6}$/i.test(accentColor)) {
      throw new Error("Choose a valid six-digit brand colour.");
    }

    const data = {
      issuedEmailMode: issuedEmailMode as Settings["issuedEmailMode"],
      expiryReminderEnabled,
      expiryReminderDays,
      senderName: senderName || null,
      replyToEmail: replyToEmail || null,
      logoUrl: validateLogoUrl(safeText(form, "logoUrl")),
      accentColor,
      issuedSubject: safeText(form, "issuedSubject"),
      issuedHeadline: safeText(form, "issuedHeadline"),
      issuedMessage: safeText(form, "issuedMessage"),
      issuedCtaLabel: safeText(form, "issuedCtaLabel"),
      expirySubject: safeText(form, "expirySubject"),
      expiryHeadline: safeText(form, "expiryHeadline"),
      expiryMessage: safeText(form, "expiryMessage"),
      expiryCtaLabel: safeText(form, "expiryCtaLabel"),
      footerText: safeText(form, "footerText") || null,
    };

    if (
      (issuedEmailMode === "CREDITFLOW_CUSTOM" || expiryReminderEnabled) &&
      (!process.env.RESEND_API_KEY || !process.env.CREDITFLOW_EMAIL_FROM)
    ) {
      throw new Error(
        "CreditFlow email delivery is not configured yet. Add RESEND_API_KEY and CREDITFLOW_EMAIL_FROM to the hosting environment first.",
      );
    }

    const saved = await db.emailNotificationSettings.upsert({
      where: { shop },
      create: { shop, ...data },
      update: data,
    });

    return Response.json({
      success: true,
      message: "Customer email settings saved.",
      settings: serializeSettings(saved),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to save email settings." },
      { status: 400 },
    );
  }
};

function replacePreviewTokens(value: string, values: Record<string, string>) {
  return value.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_match, key: string) => values[key] ?? "");
}

function Field({
  label,
  hint,
  value,
  name,
  onChange,
  maxLength,
}: {
  label: string;
  hint?: string;
  value: string;
  name: string;
  onChange: (value: string) => void;
  maxLength?: number;
}) {
  return (
    <label className="cfe-field">
      <span className="cfe-field-label">{label}</span>
      <input
        name={name}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {hint ? <span className="cfe-hint">{hint}</span> : null}
    </label>
  );
}

function MessageField({
  label,
  hint,
  value,
  name,
  onChange,
  maxLength,
}: {
  label: string;
  hint?: string;
  value: string;
  name: string;
  onChange: (value: string) => void;
  maxLength?: number;
}) {
  return (
    <label className="cfe-field">
      <span className="cfe-field-label">{label}</span>
      <textarea
        name={name}
        rows={3}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {hint ? <span className="cfe-hint">{hint}</span> : null}
    </label>
  );
}

export default function NotificationsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [settings, setSettings] = useState<Settings>(data.settings);
  const [previewType, setPreviewType] = useState<"issued" | "expiry">("issued");

  useEffect(() => {
    if (fetcher.data && "settings" in fetcher.data && fetcher.data.settings) {
      setSettings(fetcher.data.settings as Settings);
    }
  }, [fetcher.data]);

  const preview = useMemo(() => {
    const issued = previewType === "issued";
    const text = issued ? settings.issuedMessage : settings.expiryMessage;
    const values = {
      shop_name: "Your Store",
      customer_first_name: "Alex",
      credit_amount: "₹250.00",
      remaining_amount: "₹180.00",
      expiry_date: "30 November 2026",
    };
    return {
      subject: replacePreviewTokens(
        issued ? settings.issuedSubject : settings.expirySubject,
        values,
      ),
      headline: replacePreviewTokens(
        issued ? settings.issuedHeadline : settings.expiryHeadline,
        values,
      ),
      message: replacePreviewTokens(text, values),
      cta: issued ? settings.issuedCtaLabel : settings.expiryCtaLabel,
    };
  }, [settings, previewType]);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const days = [7, 3, 1];
  const saving = fetcher.state !== "idle";
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const success = fetcher.data && "message" in fetcher.data ? fetcher.data.message : null;

  return (
    <s-page heading="Customer emails">
      <div className="cfe-page">
        <style>{`.cfe-page{display:grid;gap:18px;padding:8px 0 36px;color:#202a26}.cfe-intro{margin:0;color:#65736b;font-size:13px;line-height:1.65;max-width:900px}.cfe-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(320px,.85fr);gap:16px;align-items:start}.cfe-card{background:#fff;border:1px solid #e2e8e4;border-radius:14px;padding:18px;display:grid;gap:15px;min-width:0}.cfe-card h2{font-size:15px;margin:0}.cfe-card p{margin:0;color:#65736b;font-size:12px;line-height:1.6}.cfe-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.cfe-field{display:grid;gap:6px;min-width:0}.cfe-field-label{font-size:12px;font-weight:650;color:#35443c}.cfe-field input,.cfe-field textarea,.cfe-select{width:100%;box-sizing:border-box;border:1px solid #d7dfda;border-radius:8px;background:#fff;padding:10px 11px;font:inherit;font-size:13px;color:#202a26}.cfe-field textarea{resize:vertical;line-height:1.5}.cfe-hint{font-size:11px;color:#78847d;line-height:1.45}.cfe-divider{height:1px;background:#edf0ed}.cfe-section-title{font-size:12px;font-weight:750;letter-spacing:.04em;text-transform:uppercase;color:#64736a}.cfe-mode{border:1px solid #e3e9e5;border-radius:10px;padding:12px;display:grid;gap:8px}.cfe-mode label{display:flex;gap:9px;align-items:flex-start;font-size:13px}.cfe-checks{display:flex;flex-wrap:wrap;gap:14px}.cfe-checks label{display:flex;gap:6px;align-items:center;font-size:12px}.cfe-status{font-size:11px;border-radius:20px;padding:5px 9px;font-weight:700;background:#f3f5f3;color:#55635b}.cfe-status--ok{background:#e8f4ec;color:#236240}.cfe-status--bad{background:#fff1dd;color:#80571d}.cfe-preview{border:1px solid #e2e8e4;border-radius:14px;background:#f4f7f5;padding:16px;display:grid;gap:12px;position:sticky;top:16px}.cfe-preview-top{display:flex;align-items:center;justify-content:space-between;gap:10px}.cfe-preview-subject{color:#6c7972;font-size:11px}.cfe-mail{max-width:520px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 8px 24px rgba(22,42,30,.07);width:100%}.cfe-mail-head{padding:30px 24px;text-align:center;border-top:5px solid #176B5B}.cfe-mail-brand{font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#75827b;font-weight:700;margin-bottom:18px}.cfe-mail-title{font-size:25px;line-height:1.18;font-weight:750;letter-spacing:-.5px;margin:0 0 14px;color:#202a26}.cfe-mail-copy{font-size:13px;line-height:1.7;color:#65736b;margin:0 0 22px;white-space:pre-wrap}.cfe-mail-button{display:inline-block;border-radius:8px;padding:12px 18px;color:#fff;font-size:12px;font-weight:750}.cfe-mail-foot{background:#f8faf8;text-align:center;padding:16px;color:#7b8780;font-size:10px;line-height:1.5}.cfe-notice{background:#f7f9f7;border:1px solid #e5ebe6;border-radius:10px;padding:12px;font-size:12px;line-height:1.6;color:#5f6e65}.cfe-alert{border-radius:9px;padding:11px 13px;font-size:12px;line-height:1.5}.cfe-alert--error{background:#fff0ee;color:#933d32}.cfe-alert--success{background:#eaf5ed;color:#27623f}.cfe-save{border:0;border-radius:9px;background:#193c31;color:white;font-weight:700;padding:12px 18px;font-size:13px;cursor:pointer}.cfe-save:disabled{opacity:.55;cursor:wait}.cfe-colour{width:46px;height:38px;padding:2px;border:1px solid #d7dfda;border-radius:8px;background:#fff}.cfe-inline{display:flex;gap:12px;align-items:center;flex-wrap:wrap}@media(max-width:900px){.cfe-grid{grid-template-columns:1fr}.cfe-preview{position:static}}@media(max-width:600px){.cfe-fields{grid-template-columns:1fr}}`}</style>

        <p className="cfe-intro">
          Design helpful, on-brand emails that make customers aware of their store credit and remind them before it expires. Shopify remains the source of truth for every credit balance and expiry.
        </p>

        {!data.emailProviderConfigured ? (
          <div className="cfe-alert cfe-alert--error">
            Branded email delivery is not configured yet. Add a Resend API key and a sender address on a verified domain in the hosting environment before enabling CreditFlow-branded emails.
          </div>
        ) : (
          <div className="cfe-notice">
            <span className="cfe-status cfe-status--ok">Email provider configured</span>
            <span> Resend is available for CreditFlow-branded delivery. The sending domain must remain verified.</span>
          </div>
        )}

        {error ? <div className="cfe-alert cfe-alert--error">{error}</div> : null}
        {success ? <div className="cfe-alert cfe-alert--success">{success}</div> : null}

        <fetcher.Form method="post">
          <div className="cfe-grid">
            <div className="cfe-card">
              <div>
                <h2>Credit issued email</h2>
                <p>Choose which service sends the customer their credit-issued message. Only one sender is used per credit grant.</p>
              </div>

              <div className="cfe-mode">
                <label>
                  <input
                    type="radio"
                    name="issuedEmailMode"
                    value="SHOPIFY_NATIVE"
                    checked={settings.issuedEmailMode === "SHOPIFY_NATIVE"}
                    onChange={() => update("issuedEmailMode", "SHOPIFY_NATIVE")}
                  />
                  <span><strong>Shopify native email</strong><br /><span className="cfe-hint">Shopify sends its standard store-credit email. Customize its template in Shopify Admin → Settings → Notifications.</span></span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="issuedEmailMode"
                    value="CREDITFLOW_CUSTOM"
                    checked={settings.issuedEmailMode === "CREDITFLOW_CUSTOM"}
                    onChange={() => update("issuedEmailMode", "CREDITFLOW_CUSTOM")}
                  />
                  <span><strong>CreditFlow branded email</strong><br /><span className="cfe-hint">CreditFlow sends the custom design shown in the preview. Shopify's native email is disabled for this grant to prevent duplicates.</span></span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="issuedEmailMode"
                    value="DISABLED"
                    checked={settings.issuedEmailMode === "DISABLED"}
                    onChange={() => update("issuedEmailMode", "DISABLED")}
                  />
                  <span><strong>Do not email on issue</strong><br /><span className="cfe-hint">Credit is still issued normally; only the email notification is disabled.</span></span>
                </label>
              </div>

              <div className="cfe-divider" />
              <div className="cfe-section-title">Brand identity</div>
              <div className="cfe-fields">
                <Field label="Sender display name" name="senderName" value={settings.senderName} onChange={(v) => update("senderName", v)} maxLength={100} />
                <Field label="Reply-to email" name="replyToEmail" value={settings.replyToEmail} onChange={(v) => update("replyToEmail", v)} maxLength={254} />
                <Field label="Logo image URL" name="logoUrl" hint="Optional HTTPS image URL." value={settings.logoUrl} onChange={(v) => update("logoUrl", v)} maxLength={2048} />
                <label className="cfe-field">
                  <span className="cfe-field-label">Brand accent colour</span>
                  <span className="cfe-inline">
                    <input className="cfe-colour" type="color" name="accentColor" value={settings.accentColor} onChange={(e) => update("accentColor", e.currentTarget.value)} />
                    <span className="cfe-hint">{settings.accentColor}</span>
                  </span>
                </label>
              </div>

              <div className="cfe-divider" />
              <div className="cfe-section-title">Credit issued content</div>
              <Field label="Email subject" name="issuedSubject" value={settings.issuedSubject} onChange={(v) => update("issuedSubject", v)} maxLength={180} />
              <Field label="Headline" name="issuedHeadline" value={settings.issuedHeadline} onChange={(v) => update("issuedHeadline", v)} maxLength={120} />
              <MessageField label="Message" name="issuedMessage" value={settings.issuedMessage} onChange={(v) => update("issuedMessage", v)} maxLength={500} hint="Tokens: {{ shop_name }}, {{ customer_first_name }}, {{ credit_amount }}" />
              <Field label="Button text" name="issuedCtaLabel" value={settings.issuedCtaLabel} onChange={(v) => update("issuedCtaLabel", v)} maxLength={40} />

              <div className="cfe-divider" />
              <div className="cfe-inline">
                <input
                  type="checkbox"
                  name="expiryReminderEnabled"
                  value="true"
                  checked={settings.expiryReminderEnabled}
                  onChange={(e) => update("expiryReminderEnabled", e.currentTarget.checked)}
                />
                <strong style={{fontSize:13}}>Send store-credit expiry reminders</strong>
              </div>
              <p>CreditFlow checks Shopify's actual remaining amount before sending. Reminders are not sent when the credit has already been fully spent.</p>
              <div className="cfe-checks">
                {days.map((day) => (
                  <label key={day}>
                    <input
                      type="checkbox"
                      name="expiryReminderDays"
                      value={String(day)}
                      checked={settings.expiryReminderDays.includes(day)}
                      onChange={(e) => {
                        const next = e.currentTarget.checked
                          ? [...settings.expiryReminderDays, day]
                          : settings.expiryReminderDays.filter((item) => item !== day);
                        update("expiryReminderDays", next.sort((a, b) => b - a));
                      }}
                    />
                    {day} day{day === 1 ? "" : "s"} before
                  </label>
                ))}
              </div>

              <div className="cfe-divider" />
              <div className="cfe-section-title">Expiry reminder content</div>
              <Field label="Email subject" name="expirySubject" value={settings.expirySubject} onChange={(v) => update("expirySubject", v)} maxLength={180} />
              <Field label="Headline" name="expiryHeadline" value={settings.expiryHeadline} onChange={(v) => update("expiryHeadline", v)} maxLength={120} />
              <MessageField label="Message" name="expiryMessage" value={settings.expiryMessage} onChange={(v) => update("expiryMessage", v)} maxLength={500} hint="Tokens: {{ shop_name }}, {{ customer_first_name }}, {{ remaining_amount }}, {{ expiry_date }}" />
              <Field label="Button text" name="expiryCtaLabel" value={settings.expiryCtaLabel} onChange={(v) => update("expiryCtaLabel", v)} maxLength={40} />
              <MessageField label="Footer note" name="footerText" value={settings.footerText} onChange={(v) => update("footerText", v)} maxLength={240} />

              <button className="cfe-save" type="submit" disabled={saving}>
                {saving ? "Saving settings…" : "Save email settings"}
              </button>
            </div>

            <aside className="cfe-preview">
              <div className="cfe-preview-top">
                <div>
                  <div className="cfe-section-title">Live email preview</div>
                  <div className="cfe-preview-subject">Subject: {preview.subject}</div>
                </div>
                <div className="cfe-inline">
                  <button type="button" className="cfe-save" style={{padding:"7px 10px",fontSize:11,background:previewType === "issued" ? "#193c31" : "#84928a"}} onClick={() => setPreviewType("issued")}>Issued</button>
                  <button type="button" className="cfe-save" style={{padding:"7px 10px",fontSize:11,background:previewType === "expiry" ? "#193c31" : "#84928a"}} onClick={() => setPreviewType("expiry")}>Expiry</button>
                </div>
              </div>
              <div className="cfe-mail">
                <div className="cfe-mail-head" style={{borderTopColor:settings.accentColor}}>
                  {settings.logoUrl && /^https:\/\//i.test(settings.logoUrl) ? <img src={settings.logoUrl} alt="Store logo" style={{maxWidth:150,maxHeight:54,objectFit:"contain",margin:"0 auto 18px",display:"block"}} /> : null}
                  <div className="cfe-mail-brand">{settings.senderName || "Your Store"}</div>
                  <h3 className="cfe-mail-title">{preview.headline || "Your store credit"}</h3>
                  <p className="cfe-mail-copy">{preview.message}</p>
                  <span className="cfe-mail-button" style={{background:settings.accentColor}}>{preview.cta || "Shop now"}</span>
                </div>
                <div className="cfe-mail-foot">{settings.footerText || "You received this email because your store credit account was updated."}<br />Store credit is managed securely by Shopify.</div>
              </div>
              <div className="cfe-notice">
                <strong>Email delivery notes</strong><br />
                • Credit-issued emails use the mode selected above.<br />
                • Expiry reminders are sent only for issued credits with a remaining Shopify balance.<br />
                • Emails are transactional and do not subscribe customers to marketing campaigns.
              </div>
            </aside>
          </div>
        </fetcher.Form>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
