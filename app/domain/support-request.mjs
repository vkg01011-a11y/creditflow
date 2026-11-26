export const SUPPORT_CATEGORIES = [
  "Billing",
  "Rewards and automation",
  "Store credit",
  "Refund reversals",
  "Customer emails",
  "Shopify integration",
  "Installation",
  "Technical issue",
  "Other",
];

export const SUPPORT_PRIORITIES = ["Normal", "High"];

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function normalizeSupportRequest(input) {
  const email = String(input?.email ?? "").trim();
  const category = String(input?.category ?? "").trim();
  const priority = String(input?.priority ?? "Normal").trim();
  const subject = String(input?.subject ?? "").replace(/[\r\n\t]+/g, " ").trim();
  const message = String(input?.message ?? "").trim();

  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    throw new Error("Enter a valid email address so support can reply.");
  }
  if (!SUPPORT_CATEGORIES.includes(category)) {
    throw new Error("Choose an issue category.");
  }
  if (!SUPPORT_PRIORITIES.includes(priority)) {
    throw new Error("Choose a valid priority.");
  }
  if (!subject || subject.length > 150) {
    throw new Error("Add a subject of up to 150 characters.");
  }
  if (!message || message.length > 5000) {
    throw new Error("Add a message of up to 5,000 characters.");
  }

  return { email, category, priority, subject, message };
}

export function buildSupportEmailText({ shop, request }) {
  return [
    "CreditFlow merchant support request",
    "Shop: " + String(shop),
    "Category: " + request.category,
    "Priority: " + request.priority,
    "Reply to: " + request.email,
    "",
    request.message,
  ].join("\n");
}
