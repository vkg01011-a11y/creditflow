export const DEFAULT_ISSUED_MESSAGE = "Thank you for shopping with {{ shop_name }}. We've added {{ credit_amount }} to your store credit account as a reward for {{ reward_reason }}.";
export const LEGACY_DEFAULT_ISSUED_MESSAGE = "Thank you for shopping with {{ shop_name }}. We've added {{ credit_amount }} to your store credit account.";

const DEFAULTS = {
  issuedSubject: "A little something for your next order",
  issuedHeadline: "You've got store credit!",
  issuedMessage: DEFAULT_ISSUED_MESSAGE,
  issuedCtaLabel: "Shop now",
  expirySubject: "Your store credit is about to expire",
  expiryHeadline: "A little reminder before it expires",
  expiryMessage: "You still have {{ remaining_amount }} in store credit. Use it before {{ expiry_date }}.",
  expiryCtaLabel: "Use my credit",
  accentColor: "#5B21B6",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function interpolateText(template, values) {
  return String(template ?? "").replace(
    /\{\{\s*([a-z_]+)\s*\}\}/gi,
    (_match, key) => String(values[key] ?? ""),
  );
}

function interpolateHtml(template, values) {
  // Merchant-authored template markup is plain text, never trusted HTML.
  // Escape the entire template before inserting escaped placeholder values.
  return escapeHtml(template ?? "").replace(
    /\{\{\s*([a-z_]+)\s*\}\}/gi,
    (_match, key) => escapeHtml(values[key] ?? ""),
  );
}

function normalizeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value ?? ""))
    ? String(value)
    : DEFAULTS.accentColor;
}

export function renderCreditEmail({ type, settings = {}, data = {} }) {
  if (type !== "issued" && type !== "expiring") {
    throw new Error("Unsupported credit email type.");
  }

  const issued = type === "issued";
  const subjectTemplate = settings[issued ? "issuedSubject" : "expirySubject"]
    || DEFAULTS[issued ? "issuedSubject" : "expirySubject"];
  const headlineTemplate = settings[issued ? "issuedHeadline" : "expiryHeadline"]
    || DEFAULTS[issued ? "issuedHeadline" : "expiryHeadline"];
  const configuredMessage = settings[issued ? "issuedMessage" : "expiryMessage"];
  const messageTemplate = issued && configuredMessage === LEGACY_DEFAULT_ISSUED_MESSAGE
    ? DEFAULT_ISSUED_MESSAGE
    : configuredMessage || DEFAULTS[issued ? "issuedMessage" : "expiryMessage"];
  const ctaLabel = settings[issued ? "issuedCtaLabel" : "expiryCtaLabel"]
    || DEFAULTS[issued ? "issuedCtaLabel" : "expiryCtaLabel"];

  const values = {
    shop_name: data.shopName ?? "",
    customer_first_name: data.customerFirstName ?? "",
    credit_amount: data.creditAmount ?? "",
    remaining_amount: data.remainingAmount ?? "",
    expiry_date: data.expiryDate ?? "",
    reward_reason: data.rewardReason ?? "your qualifying order",
  };

  const subject = interpolateText(subjectTemplate, values)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 180);
  const headlineText = interpolateText(headlineTemplate, values);
  const messageText = interpolateText(messageTemplate, values);
  const headline = interpolateHtml(headlineTemplate, values);
  const message = interpolateHtml(messageTemplate, values);
  const color = normalizeColor(settings.accentColor);
  const shopName = escapeHtml(data.shopName ?? "Our store");
  const logoUrl = safeHttpsUrl(settings.logoUrl);
  const ctaUrl = safeHttpsUrl(data.shopUrl);
  const button = ctaUrl
    ? '<a href="' + escapeHtml(ctaUrl) + '" style="display:inline-block;background:' + color + ';color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:8px;font-size:15px;font-weight:700;">' + escapeHtml(ctaLabel) + '</a>'
    : "";
  const logo = logoUrl
    ? '<img src="' + escapeHtml(logoUrl) + '" alt="' + shopName + '" style="max-width:160px;max-height:54px;object-fit:contain;display:block;margin:0 auto 22px;">'
    : "";
  const firstName = data.customerFirstName
    ? "Hi " + escapeHtml(data.customerFirstName) + ","
    : "Hello,";
  const footerText = settings.footerText ||
    ["You received this email because", data.shopName ?? "this store", "updated your store credit account."].join(" ");
  const footer = escapeHtml(footerText);

  const html = [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>',
    escapeHtml(subject),
    '</title></head>',
    '<body style="margin:0;padding:0;background:#f4f6f5;font-family:Arial,Helvetica,sans-serif;color:#1d2925;">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f5;padding:32px 12px;"><tr><td align="center">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px;background:#ffffff;border-radius:16px;overflow:hidden;">',
    '<tr><td style="padding:36px 34px 32px;text-align:center;border-top:5px solid ' + color + ';">',
    logo,
    '<div style="font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:#718078;font-weight:700;margin-bottom:18px;">' + shopName + '</div>',
    '<div style="font-size:28px;line-height:1.2;font-weight:700;letter-spacing:-.5px;margin:0 0 18px;">' + headline + '</div>',
    '<div style="font-size:15px;line-height:1.7;color:#596760;margin:0 0 12px;">' + firstName + '</div>',
    '<div style="font-size:15px;line-height:1.7;color:#596760;margin:0 auto 26px;max-width:440px;">' + message.replace(/\r?\n/g, "<br>") + '</div>',
    button,
    '</td></tr>',
    '<tr><td style="background:#f9fbfa;padding:20px 28px;text-align:center;color:#7a8780;font-size:11px;line-height:1.6;">' + footer + '<br><span>Store credit is managed securely by Shopify.</span></td></tr>',
    '</table></td></tr></table></body></html>',
  ].join("");

  const text = [
    data.shopName ?? "Our store",
    "",
    headlineText,
    "",
    data.customerFirstName ? "Hi " + data.customerFirstName + "," : "Hello,",
    messageText,
    "",
    ctaUrl ? ctaLabel + ": " + ctaUrl : "",
    "",
    footerText,
  ].filter(Boolean).join("\n");

  return { subject, html, text };
}

export { DEFAULTS };
