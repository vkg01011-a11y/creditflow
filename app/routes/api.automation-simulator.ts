import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { decimalPattern } from "../domain/decimal-validation.mjs";
import { simulateAutomationRule } from "../domain/automation-simulator.mjs";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decimal(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!decimalPattern(6).test(text)) {
    throw new Error(`${field} must be a non-negative amount with up to 6 decimal places.`);
  }
  return text;
}

function splitList(value: unknown, field: string, maxItems = 50): string[] {
  if (value == null || value === "") return [];
  const values = Array.isArray(value)
    ? value
    : String(value).split(/[\n,]/);
  if (values.length > maxItems) throw new Error(`${field} contains too many values.`);
  return values.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeProductId(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const match = text.match(/^(?:gid:\/\/shopify\/Product\/)?(\d+)$/);
  if (!match) throw new Error("Product ID must be a numeric Shopify product ID.");
  return match[1];
}

function parseSample(value: unknown) {
  if (!isObject(value)) throw new Error("Sample order data is required.");

  const currencyCode = String(value.currencyCode ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error("Select a valid three-letter currency code.");

  const paymentStatus = String(value.paymentStatus ?? "UNKNOWN").toUpperCase();
  if (!["PREPAID", "COD", "UNKNOWN"].includes(paymentStatus)) {
    throw new Error("Payment status must be PREPAID, COD or UNKNOWN.");
  }

  const rawItems = value.lineItems;
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 100) {
    throw new Error("Add between 1 and 100 sample line items.");
  }

  const lineItems = rawItems.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`Line item ${index + 1} is invalid.`);
    const quantity = Number(raw.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) {
      throw new Error(`Line item ${index + 1} quantity must be a positive whole number.`);
    }
    return {
      product_id: normalizeProductId(raw.productId),
      quantity,
      price: decimal(raw.price, `Line item ${index + 1} price`),
      total_discount: decimal(raw.totalDiscount ?? "0", `Line item ${index + 1} discount`),
    };
  });

  const shippingCountry = String(value.shippingCountry ?? "").trim().toUpperCase();
  if (shippingCountry && !/^[A-Z]{2}$/.test(shippingCountry)) {
    throw new Error("Shipping country must be a two-letter country code.");
  }

  let customer: { tags: string[]; numberOfOrders: string } | null = null;
  if (value.includeCustomer === true) {
    const orderCount = Number(value.customerOrderCount ?? 0);
    if (!Number.isInteger(orderCount) || orderCount < 0 || orderCount > 1000000000) {
      throw new Error("Customer order count must be a non-negative whole number.");
    }
    customer = {
      tags: splitList(value.customerTags, "Customer tags"),
      numberOfOrders: String(orderCount),
    };
  }

  return {
    currencyCode,
    orderSubtotal: decimal(value.orderSubtotal, "Order subtotal"),
    paymentStatus,
    lineItems,
    orderTags: splitList(value.orderTags, "Order tags"),
    discountCodes: splitList(value.discountCodes, "Discount codes"),
    shippingCountry,
    customer,
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "A valid JSON body is required." }, { status: 400 });
  }

  if (!isObject(body)) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const ruleId = String(body.ruleId ?? "").trim();
    if (!ruleId || ruleId.length > 100) throw new Error("Select an automation to simulate.");

    const sample = parseSample(body.sample);
    const rule = await db.automationRule.findFirst({
      where: { id: ruleId, shop: session.shop },
    });

    if (!rule) {
      return Response.json(
        { error: "Automation not found for this Shopify store." },
        { status: 404, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    if (rule.archivedAt) {
      return Response.json(
        { error: "Restore this archived automation before simulating it." },
        { status: 409, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const simulation = simulateAutomationRule({ rule, sample });

    return Response.json(
      { simulation },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error
          ? error.message
          : "Unable to simulate this automation.",
      },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
};
