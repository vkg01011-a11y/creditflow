
import { Prisma } from "@prisma/client";
import type { AutomationRule } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { decimalPattern } from "../domain/decimal-validation.mjs";

type JsonObject = Record<string, unknown>;

type ConditionField =
  | "ORDER_SUBTOTAL"
  | "ITEM_QUANTITY"
  | "PAYMENT_STATUS"
  | "ORDER_TAG"
  | "DISCOUNT_CODE"
  | "SHIPPING_COUNTRY"
  | "CUSTOMER_TAG"
  | "CUSTOMER_ORDER_COUNT";

type ConditionOperator =
  | "EQUALS"
  | "NOT_EQUALS"
  | "GREATER_THAN"
  | "GREATER_THAN_OR_EQUAL"
  | "LESS_THAN"
  | "LESS_THAN_OR_EQUAL"
  | "CONTAINS"
  | "NOT_CONTAINS";

type CleanCondition = {
  field: ConditionField;
  operator: ConditionOperator;
  value: string;
};

type CleanConditionGroup = {
  version: 1;
  logic: "AND" | "OR";
  rules: CleanCondition[];
};

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

  const pattern = decimalPattern(decimals);

  if (!pattern.test(text)) {
    throw new Error(`${field} is not a valid decimal amount.`);
  }

  const number = Number(text);

  if (!Number.isFinite(number)) {
    throw new Error(`${field} is invalid.`);
  }

  if (options.allowZero ? number < 0 : number <= 0) {
    throw new Error(
      options.allowZero
        ? `${field} cannot be negative.`
        : `${field} must be greater than zero.`,
    );
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

  return [
    ...new Set(
      value.map((item) => {
        const text = String(item).trim();

        const match = text.match(
          /^(?:gid:\/\/shopify\/Product\/)?(\d+)$/,
        );

        if (!match) {
          throw new Error(`Invalid Shopify product ID: ${text}`);
        }

        return match[1];
      }),
    ),
  ];
}

const NUMERIC_FIELDS = new Set<ConditionField>([
  "ORDER_SUBTOTAL",
  "ITEM_QUANTITY",
  "CUSTOMER_ORDER_COUNT",
]);

const INTEGER_FIELDS = new Set<ConditionField>([
  "ITEM_QUANTITY",
  "CUSTOMER_ORDER_COUNT",
]);

const TEXT_FIELDS = new Set<ConditionField>([
  "ORDER_TAG",
  "DISCOUNT_CODE",
  "CUSTOMER_TAG",
]);

const EQUALITY_OPERATORS = new Set<ConditionOperator>([
  "EQUALS",
  "NOT_EQUALS",
]);

const NUMERIC_OPERATORS = new Set<ConditionOperator>([
  "EQUALS",
  "NOT_EQUALS",
  "GREATER_THAN",
  "GREATER_THAN_OR_EQUAL",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
]);

const TEXT_OPERATORS = new Set<ConditionOperator>([
  "EQUALS",
  "NOT_EQUALS",
  "CONTAINS",
  "NOT_CONTAINS",
]);

const CONDITION_FIELDS = new Set<ConditionField>([
  "ORDER_SUBTOTAL",
  "ITEM_QUANTITY",
  "PAYMENT_STATUS",
  "ORDER_TAG",
  "DISCOUNT_CODE",
  "SHIPPING_COUNTRY",
  "CUSTOMER_TAG",
  "CUSTOMER_ORDER_COUNT",
]);

const CONDITION_OPERATORS = new Set<ConditionOperator>([
  "EQUALS",
  "NOT_EQUALS",
  "GREATER_THAN",
  "GREATER_THAN_OR_EQUAL",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
  "CONTAINS",
  "NOT_CONTAINS",
]);

function parseConditionGroup(value: unknown): CleanConditionGroup {
  if (value === undefined || value === null) {
    return {
      version: 1,
      logic: "AND",
      rules: [],
    };
  }

  if (!isObject(value)) {
    throw new Error("conditions must be an object.");
  }

  const logic = value.logic ?? "AND";

  if (logic !== "AND" && logic !== "OR") {
    throw new Error("Condition logic must be AND or OR.");
  }

  const rawRules = value.rules ?? [];

  if (!Array.isArray(rawRules)) {
    throw new Error("conditions.rules must be an array.");
  }

  if (rawRules.length > 20) {
    throw new Error("A maximum of 20 conditions is supported per rule.");
  }

  const rules: CleanCondition[] = rawRules.map(
    (rawCondition, index) => {
      if (!isObject(rawCondition)) {
        throw new Error(`Condition ${index + 1} is invalid.`);
      }

      const fieldText = requiredText(
        rawCondition.field,
        `Condition ${index + 1} field`,
        50,
      );

      const operatorText = requiredText(
        rawCondition.operator,
        `Condition ${index + 1} operator`,
        50,
      );

      if (!CONDITION_FIELDS.has(fieldText as ConditionField)) {
        throw new Error(
          `Condition ${index + 1} uses an unsupported field.`,
        );
      }

      if (
        !CONDITION_OPERATORS.has(
          operatorText as ConditionOperator,
        )
      ) {
        throw new Error(
          `Condition ${index + 1} uses an unsupported operator.`,
        );
      }

      const field = fieldText as ConditionField;
      const operator = operatorText as ConditionOperator;

      if (
        NUMERIC_FIELDS.has(field) &&
        !NUMERIC_OPERATORS.has(operator)
      ) {
        throw new Error(
          `The selected operator is not valid for ${field}.`,
        );
      }

      if (
        TEXT_FIELDS.has(field) &&
        !TEXT_OPERATORS.has(operator)
      ) {
        throw new Error(
          `The selected operator is not valid for ${field}.`,
        );
      }

      if (
        (
          field === "PAYMENT_STATUS" ||
          field === "SHIPPING_COUNTRY"
        ) &&
        !EQUALITY_OPERATORS.has(operator)
      ) {
        throw new Error(
          `The selected operator is not valid for ${field}.`,
        );
      }

      let conditionValue: string;

      if (NUMERIC_FIELDS.has(field)) {
        conditionValue =
          decimalValue(
            rawCondition.value,
            `Condition ${index + 1} value`,
            {
              required: true,
              allowZero: true,
              maxDecimals: INTEGER_FIELDS.has(field) ? 0 : 6,
            },
          ) ?? "0";
      } else {
        conditionValue = requiredText(
          rawCondition.value,
          `Condition ${index + 1} value`,
          100,
        );
      }

      if (field === "PAYMENT_STATUS") {
        conditionValue = conditionValue.toUpperCase();

        if (
          !["PREPAID", "COD", "UNKNOWN"].includes(conditionValue)
        ) {
          throw new Error(
            "Payment status must be PREPAID, COD or UNKNOWN.",
          );
        }
      }

      if (field === "SHIPPING_COUNTRY") {
        conditionValue = conditionValue.toUpperCase();

        if (!/^[A-Z]{2}$/.test(conditionValue)) {
          throw new Error(
            "Shipping country must be a two-letter country code.",
          );
        }
      }

      return {
        field,
        operator,
        value: conditionValue,
      };
    },
  );

  return {
    version: 1,
    logic,
    rules,
  };
}

function buildRuleData(body: JsonObject) {
  const name = requiredText(body.name, "name", 100);

  const description = optionalText(
    body.description,
    "description",
    500,
  );

  const trigger = body.trigger ?? "ORDER_FULFILLED";

  if (trigger !== "ORDER_FULFILLED") {
    throw new Error(
      "Only ORDER_FULFILLED is currently supported by the active processor.",
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

  return {
    name,
    description,
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
    conditions: parseConditionGroup(body.conditions),
    requirePrepaid: body.requirePrepaid ?? false,
    expiryDays,
    notifyCustomer: body.notifyCustomer ?? true,
  };
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
    conditions: rule.conditions ?? {
      version: 1,
      logic: "AND",
      rules: [],
    },
    archivedAt:
      "archivedAt" in rule && rule.archivedAt instanceof Date
        ? rule.archivedAt.toISOString()
        : null,
  };
}

async function getAuthenticatedShop(request: Request) {
  const { session } = await authenticate.admin(request);
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
      { archivedAt: "asc" },
      { priority: "asc" },
      { createdAt: "desc" },
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

  try {
    const ruleId = () =>
      requiredText(body.ruleId, "ruleId", 100);

    // Enable / pause
    if (operation === "toggle") {
      const id = ruleId();

      if (typeof body.enabled !== "boolean") {
        return Response.json(
          { error: "enabled must be a boolean." },
          { status: 400 },
        );
      }

      const result = await db.automationRule.updateMany({
        where: {
          id,
          shop,
          archivedAt: null,
        },
        data: {
          enabled: body.enabled,
        },
      });

      if (result.count === 0) {
        return Response.json(
          { error: "Automation rule not found or archived." },
          { status: 404 },
        );
      }

      return Response.json({
        success: true,
        operation,
        ruleId: id,
        enabled: body.enabled,
      });
    }

    // Archive
    if (operation === "archive") {
      const id = ruleId();

      const result = await db.automationRule.updateMany({
        where: {
          id,
          shop,
          archivedAt: null,
        },
        data: {
          enabled: false,
          archivedAt: new Date(),
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
        operation,
        ruleId: id,
      });
    }

    // Restore a rule as paused. Merchant must deliberately enable it.
    if (operation === "restore") {
      const id = ruleId();

      const result = await db.automationRule.updateMany({
        where: {
          id,
          shop,
          archivedAt: { not: null },
        },
        data: {
          archivedAt: null,
          enabled: false,
        },
      });

      if (result.count === 0) {
        return Response.json(
          { error: "Archived automation rule not found." },
          { status: 404 },
        );
      }

      return Response.json({
        success: true,
        operation,
        ruleId: id,
      });
    }

    // Duplicate a rule as a paused copy.
    if (operation === "duplicate") {
      const id = ruleId();

      const source = await db.automationRule.findFirst({
        where: {
          id,
          shop,
          archivedAt: null,
        },
      });

      if (!source) {
        return Response.json(
          { error: "Automation rule not found." },
          { status: 404 },
        );
      }

      const clonedConditions =
        source.conditions == null
          ? {
              version: 1,
              logic: "AND",
              rules: [],
            }
          : (
              JSON.parse(
                JSON.stringify(source.conditions),
              ) as Prisma.InputJsonValue
            );

      const duplicate = await db.automationRule.create({
        data: {
          shop,
          name: `${source.name} (Copy)`.slice(0, 100),
          description: source.description,
          enabled: false,
          trigger: source.trigger,
          priority: source.priority,
          rewardType: source.rewardType,
          rewardBase: source.rewardBase,
          percentage: source.percentage?.toString() ?? null,
          fixedAmount: source.fixedAmount?.toString() ?? null,
          minimumOrderValue:
            source.minimumOrderValue?.toString() ?? null,
          maximumReward:
            source.maximumReward?.toString() ?? null,
          productMode: source.productMode,
          productIds: source.productIds,
          conditions: clonedConditions,
          requirePrepaid: source.requirePrepaid,
          expiryDays: source.expiryDays,
          notifyCustomer: source.notifyCustomer,
        },
      });

      return Response.json({
        success: true,
        operation,
        rule: serializeRule(duplicate),
      });
    }

    // Create or update
    if (operation === "create" || operation === "update") {
      const data = buildRuleData(body);

      if (operation === "create") {
        const rule = await db.automationRule.create({
          data: {
            shop,
            ...data,
            enabled: body.enabled !== false,
          },
        });

        return Response.json(
          {
            success: true,
            operation,
            rule: serializeRule(rule),
          },
          { status: 201 },
        );
      }

      const id = ruleId();

      const result = await db.automationRule.updateMany({
        where: {
          id,
          shop,
          archivedAt: null,
        },
        data,
      });

      if (result.count === 0) {
        return Response.json(
          { error: "Automation rule not found or archived." },
          { status: 404 },
        );
      }

      const updated = await db.automationRule.findFirst({
        where: {
          id,
          shop,
          archivedAt: null,
        },
      });

      if (!updated) {
        return Response.json(
          { error: "Unable to load updated automation." },
          { status: 500 },
        );
      }

      return Response.json({
        success: true,
        operation,
        rule: serializeRule(updated),
      });
    }

    return Response.json(
      { error: "Unsupported automation operation." },
      { status: 400 },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to process automation request.",
      },
      { status: 400 },
    );
  }
};
