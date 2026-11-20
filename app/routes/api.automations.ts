import type { AutomationRule } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { activateMerchant } from "../services/merchant.server";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function optionalText(
  value: unknown,
  field: string,
  maxLength = 200,
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${field} must be text.`);
  }

  const result = value.trim();

  if (result.length > maxLength) {
    throw new Error(`${field} is too long.`);
  }

  return result || null;
}

function requiredText(
  value: unknown,
  field: string,
  maxLength = 100,
): string {
  const result = optionalText(value, field, maxLength);

  if (!result) {
    throw new Error(`${field} is required.`);
  }

  return result;
}

function decimalValue(
  value: unknown,
  field: string,
  options: {
    required?: boolean;
    allowZero?: boolean;
    maximum?: number;
    maxDecimals?: number;
  } = {},
): string | null {
  if (value === undefined || value === null || value === "") {
    if (options.required) {
      throw new Error(`${field} is required.`);
    }

    return null;
  }

  const text = String(value).trim();
  const decimals = options.maxDecimals ?? 6;

  const pattern = new RegExp(
    `^\\d{1,14}(?:\\.\\d{1,${decimals}})?$`,
  );

  if (!pattern.test(text)) {
    throw new Error(`${field} is not a valid decimal amount.`);
  }

  const number = Number(text);

  if (!Number.isFinite(number)) {
    throw new Error(`${field} is invalid.`);
  }

  if (options.allowZero ? number < 0 : number <= 0) {
    throw new Error(`${field} must be greater than zero.`);
  }

  if (
    options.maximum !== undefined &&
    number > options.maximum
  ) {
    throw new Error(`${field} exceeds the permitted maximum.`);
  }

  return text;
}

function normalizeProductIds(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("productIds must be an array.");
  }

  if (value.length > 500) {
    throw new Error("A maximum of 500 products can be selected.");
  }

  return [...new Set(
    value.map((item) => {
      const text = String(item).trim();

      const match = text.match(
        /^(?:gid:\/\/shopify\/Product\/)?(\d+)$/,
      );

      if (!match) {
        throw new Error(`Invalid Shopify product ID: ${text}`);
      }

      // The existing fulfilment engine consumes REST numeric product IDs.
      return match[1];
    }),
  )];
}

function serializeRule(rule: AutomationRule) {
  let productIds: string[] = [];

  try {
    const parsed = JSON.parse(rule.productIds || "[]");
    productIds = Array.isArray(parsed)
      ? parsed.map(String)
      : [];
  } catch {
    productIds = [];
  }

  return {
    ...rule,
    percentage: rule.percentage?.toString() ?? null,
    fixedAmount: rule.fixedAmount?.toString() ?? null,
    minimumOrderValue:
      rule.minimumOrderValue?.toString() ?? null,
    maximumReward: rule.maximumReward?.toString() ?? null,
    productIds,
  };
}

async function getAuthenticatedShop(request: Request) {
  const { session } = await authenticate.admin(request);

  await activateMerchant(session.shop);

  return session.shop;
}

// GET /api/automations
export const loader = async ({
  request,
}: LoaderFunctionArgs) => {
  const shop = await getAuthenticatedShop(request);

  const rules = await db.automationRule.findMany({
    where: { shop },
    orderBy: [
      { priority: "asc" },
      { createdAt: "asc" },
    ],
  });

  return Response.json({
    rules: rules.map(serializeRule),
  });
};

// POST /api/automations
export const action = async ({
  request,
}: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed." },
      { status: 405 },
    );
  }

  const shop = await getAuthenticatedShop(request);

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "A valid JSON body is required." },
      { status: 400 },
    );
  }

  if (!isObject(body)) {
    return Response.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const operation = body.operation;

  if (operation === "toggle") {
    const ruleId = requiredText(body.ruleId, "ruleId", 100);

    if (typeof body.enabled !== "boolean") {
      return Response.json(
        { error: "enabled must be a boolean." },
        { status: 400 },
      );
    }

    const result = await db.automationRule.updateMany({
      where: {
        id: ruleId,
        shop,
      },
      data: {
        enabled: body.enabled,
      },
    });

    if (result.count === 0) {
      return Response.json(
        { error: "Automation rule not found." },
        { status: 404 },
      );
    }

    return Response.json({
      success: true,
      ruleId,
      enabled: body.enabled,
    });
  }

  if (operation !== "create") {
    return Response.json(
      { error: "Unsupported automation operation." },
      { status: 400 },
    );
  }

  try {
    const name = requiredText(body.name, "name", 100);
    const description = optionalText(
      body.description,
      "description",
      500,
    );

    const trigger = body.trigger ?? "ORDER_FULFILLED";

    // The current reward processor supports fully fulfilled orders.
    if (trigger !== "ORDER_FULFILLED") {
      throw new Error(
        "Only ORDER_FULFILLED is currently supported.",
      );
    }

    const rewardType = body.rewardType;

    if (
      rewardType !== "PERCENTAGE" &&
      rewardType !== "FIXED"
    ) {
      throw new Error("Invalid rewardType.");
    }

    const rewardBase = body.rewardBase ?? "ORDER_SUBTOTAL";

    if (
      rewardBase !== "ORDER_SUBTOTAL" &&
      rewardBase !== "ELIGIBLE_ITEMS"
    ) {
      throw new Error("Invalid rewardBase.");
    }

    const productMode = body.productMode ?? "ALL";

    if (
      productMode !== "ALL" &&
      productMode !== "INCLUDE" &&
      productMode !== "EXCLUDE"
    ) {
      throw new Error("Invalid productMode.");
    }

    const productIds = normalizeProductIds(body.productIds);

    if (
      productMode === "INCLUDE" &&
      productIds.length === 0
    ) {
      throw new Error(
        "Select at least one product for INCLUDE mode.",
      );
    }

    const percentage =
      rewardType === "PERCENTAGE"
        ? decimalValue(body.percentage, "percentage", {
            required: true,
            maximum: 100,
            maxDecimals: 2,
          })
        : null;

    const fixedAmount =
      rewardType === "FIXED"
        ? decimalValue(body.fixedAmount, "fixedAmount", {
            required: true,
          })
        : null;

    const minimumOrderValue = decimalValue(
      body.minimumOrderValue,
      "minimumOrderValue",
      { allowZero: true },
    );

    const maximumReward = decimalValue(
      body.maximumReward,
      "maximumReward",
    );

    const expiryDays =
      body.expiryDays === undefined ||
      body.expiryDays === null ||
      body.expiryDays === ""
        ? null
        : Number(body.expiryDays);

    if (
      expiryDays !== null &&
      (
        !Number.isInteger(expiryDays) ||
        expiryDays < 1 ||
        expiryDays > 3650
      )
    ) {
      throw new Error(
        "expiryDays must be between 1 and 3650.",
      );
    }

    const priority = Number(body.priority ?? 100);

    if (
      !Number.isInteger(priority) ||
      priority < 0 ||
      priority > 100000
    ) {
      throw new Error("Invalid automation priority.");
    }

    if (
      body.requirePrepaid !== undefined &&
      typeof body.requirePrepaid !== "boolean"
    ) {
      throw new Error("requirePrepaid must be a boolean.");
    }

    if (
      body.notifyCustomer !== undefined &&
      typeof body.notifyCustomer !== "boolean"
    ) {
      throw new Error("notifyCustomer must be a boolean.");
    }

    const rule = await db.automationRule.create({
      data: {
        shop,
        name,
        description,
        enabled: body.enabled !== false,
        trigger,
        priority,
        rewardType,
        rewardBase,
        percentage,
        fixedAmount,
        minimumOrderValue,
        maximumReward,
        productMode,
        productIds: JSON.stringify(productIds),
        requirePrepaid: body.requirePrepaid ?? false,
        expiryDays,
        notifyCustomer: body.notifyCustomer ?? true,
      },
    });

    return Response.json(
      {
        success: true,
        rule: serializeRule(rule),
      },
      { status: 201 },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to create automation.",
      },
      { status: 400 },
    );
  }
};
 