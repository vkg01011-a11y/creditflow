import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSupportEmailText,
  normalizeSupportRequest,
} from "../app/domain/support-request.mjs";

const valid = {
  email: "merchant@example.com",
  category: "Billing",
  priority: "Normal",
  subject: "Question about usage",
  message: "Can you explain this billing cycle?",
};

test("normalizes a valid merchant support request", () => {
  assert.deepEqual(normalizeSupportRequest(valid), valid);
});

test("rejects invalid email, category, priority and oversized content", () => {
  assert.throws(() => normalizeSupportRequest({ ...valid, email: "not-email" }), /valid email/);
  assert.throws(() => normalizeSupportRequest({ ...valid, category: "Credentials" }), /category/);
  assert.throws(() => normalizeSupportRequest({ ...valid, priority: "Urgent" }), /priority/);
  assert.throws(() => normalizeSupportRequest({ ...valid, message: "x".repeat(5001) }), /5,000/);
});

test("prevents subject header injection and excludes customer or credential fields", () => {
  const request = normalizeSupportRequest({ ...valid, subject: "Billing\r\nBcc: attacker@example.com" });
  const body = buildSupportEmailText({ shop: "north.myshopify.com", request });

  assert.equal(request.subject.includes("\n"), false);
  assert.match(body, /north\.myshopify\.com/);
  assert.equal(body.includes("Bcc:"), false);
  assert.equal(body.includes("customerGid"), false);
  assert.equal(body.includes("access_token"), false);
});
