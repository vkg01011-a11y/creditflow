import test from "node:test";
import assert from "node:assert/strict";

import { renderCreditEmail } from "../app/domain/email-template.mjs";

const settings = {
  issuedSubject: "You earned {{ credit_amount }} at {{ shop_name }}",
  issuedHeadline: "A reward for you, {{ customer_first_name }}",
  issuedMessage: "Your credit is {{ credit_amount }}.",
  issuedCtaLabel: "Browse the collection",
  accentColor: "#123456",
  logoUrl: "https://cdn.example.com/logo.png",
};

test("renders issued-credit subject, personalized headline and safe CTA", () => {
  const result = renderCreditEmail({
    type: "issued",
    settings,
    data: {
      shopName: "North & Co",
      customerFirstName: "Ava",
      creditAmount: "₹250.00",
      shopUrl: "https://north.example.com",
    },
  });

  assert.equal(result.subject, "You earned ₹250.00 at North &amp; Co");
  assert.match(result.html, /A reward for you, Ava/);
  assert.match(result.html, /https:\/\/north\.example\.com/);
  assert.match(result.html, /#123456/);
  assert.match(result.html, /Browse the collection/);
});

test("escapes merchant text and untrusted customer values", () => {
  const result = renderCreditEmail({
    type: "issued",
    settings: {
      issuedHeadline: "<script>alert(1)</script>",
      issuedMessage: "Welcome {{ customer_first_name }}",
      issuedSubject: "Your reward",
    },
    data: {
      shopName: "<img src=x>",
      customerFirstName: "<b>Ava</b>",
      shopUrl: "javascript:alert(1)",
    },
  });

  assert.equal(result.html.includes("<script>"), false);
  assert.equal(result.html.includes("<b>Ava</b>"), false);
  assert.equal(result.html.includes("javascript:"), false);
  assert.match(result.html, /&lt;script&gt;/);
});

test("renders expiry reminder values", () => {
  const result = renderCreditEmail({
    type: "expiring",
    settings: {
      expirySubject: "{{ remaining_amount }} expires soon",
      expiryHeadline: "Don't lose your credit",
      expiryMessage: "Use {{ remaining_amount }} by {{ expiry_date }}.",
      expiryCtaLabel: "Spend credit",
    },
    data: {
      shopName: "North Store",
      remainingAmount: "₹100",
      expiryDate: "28 November 2026",
      shopUrl: "https://north.example.com",
    },
  });

  assert.equal(result.subject, "₹100 expires soon");
  assert.match(result.text, /Use ₹100 by 28 November 2026/);
  assert.match(result.html, /Spend credit/);
});

test("rejects unsupported email type and unsafe logo urls", () => {
  assert.throws(
    () => renderCreditEmail({ type: "refund", settings, data: {} }),
    /Unsupported credit email type/,
  );

  const result = renderCreditEmail({
    type: "issued",
    settings: { logoUrl: "http://insecure.example/logo.png" },
    data: { shopName: "Store", shopUrl: "https://store.example" },
  });
  assert.equal(result.html.includes("<img"), false);
});
