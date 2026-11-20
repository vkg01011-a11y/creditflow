
import { useEffect, useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";

import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { activateMerchant } from "../services/merchant.server";

type ProductOption = {
  id: string;
  title: string;
  handle: string;
};

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

type RuleCondition = {
  field: ConditionField;
  operator: ConditionOperator;
  value: string;
};

type ConditionGroup = {
  version: 1;
  logic: "AND" | "OR";
  rules: RuleCondition[];
};

type Rule = {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  trigger: string;
  priority: number;
  rewardType: string;
  rewardBase: string;
  percentage: string | null;
  fixedAmount: string | null;
  minimumOrderValue: string | null;
  maximumReward: string | null;
  productMode: string;
  productIds: string[];
  conditions: ConditionGroup;
  requirePrepaid: boolean;
  expiryDays: number | null;
  notifyCustomer: boolean;
  createdAt: string;
  archivedAt: string | null;
};

type FormState = {
  name: string;
  description: string;
  rewardType: "PERCENTAGE" | "FIXED";
  percentage: string;
  fixedAmount: string;
  rewardBase: "ORDER_SUBTOTAL" | "ELIGIBLE_ITEMS";
  minimumOrderValue: string;
  maximumReward: string;
  productMode: "ALL" | "INCLUDE" | "EXCLUDE";
  productIds: string[];
  conditions: ConditionGroup;
  requirePrepaid: boolean;
  expiryDays: string;
  notifyCustomer: boolean;
  priority: string;
};

type ActionResponse = {
  success?: boolean;
  error?: string;
  operation?: string;
  rule?: { id: string };
};

type Notice = {
  type: "success" | "error";
  message: string;
};

type Filter = "ALL" | "ACTIVE" | "PAUSED" | "ARCHIVED";

const CONDITION_FIELDS: Array<{
  value: ConditionField;
  label: string;
}> = [
  { value: "ORDER_SUBTOTAL", label: "Order subtotal" },
  { value: "ITEM_QUANTITY", label: "Total item quantity" },
  { value: "PAYMENT_STATUS", label: "Payment status" },
  { value: "CUSTOMER_ORDER_COUNT", label: "Customer order count" },
  { value: "CUSTOMER_TAG", label: "Customer tag" },
  { value: "ORDER_TAG", label: "Order tag" },
  { value: "DISCOUNT_CODE", label: "Discount code" },
  { value: "SHIPPING_COUNTRY", label: "Shipping country" },
];

const NUMERIC_FIELDS = new Set<ConditionField>([
  "ORDER_SUBTOTAL",
  "ITEM_QUANTITY",
  "CUSTOMER_ORDER_COUNT",
]);

const TEXT_FIELDS = new Set<ConditionField>([
  "ORDER_TAG",
  "DISCOUNT_CODE",
  "CUSTOMER_TAG",
]);

const EQUALITY_OPERATORS: ConditionOperator[] = [
  "EQUALS",
  "NOT_EQUALS",
];

const NUMERIC_OPERATORS: ConditionOperator[] = [
  "EQUALS",
  "NOT_EQUALS",
  "GREATER_THAN",
  "GREATER_THAN_OR_EQUAL",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
];

const TEXT_OPERATORS: ConditionOperator[] = [
  "CONTAINS",
  "NOT_CONTAINS",
  "EQUALS",
  "NOT_EQUALS",
];

function operatorsForField(
  field: ConditionField,
): ConditionOperator[] {
  if (NUMERIC_FIELDS.has(field)) return NUMERIC_OPERATORS;

  if (TEXT_FIELDS.has(field)) return TEXT_OPERATORS;

  return EQUALITY_OPERATORS;
}

function defaultOperator(field: ConditionField): ConditionOperator {
  if (NUMERIC_FIELDS.has(field)) {
    return "GREATER_THAN_OR_EQUAL";
  }

  if (TEXT_FIELDS.has(field)) {
    return "CONTAINS";
  }

  return "EQUALS";
}

function defaultValue(field: ConditionField) {
  switch (field) {
    case "ORDER_SUBTOTAL":
      return "5000";
    case "ITEM_QUANTITY":
      return "2";
    case "CUSTOMER_ORDER_COUNT":
      return "2";
    case "PAYMENT_STATUS":
      return "PREPAID";
    case "SHIPPING_COUNTRY":
      return "IN";
    default:
      return "";
  }
}

function emptyConditions(): ConditionGroup {
  return {
    version: 1,
    logic: "AND",
    rules: [],
  };
}

function initialForm(): FormState {
  return {
    name: "",
    description: "",
    rewardType: "PERCENTAGE",
    percentage: "2",
    fixedAmount: "100",
    rewardBase: "ORDER_SUBTOTAL",
    minimumOrderValue: "",
    maximumReward: "",
    productMode: "ALL",
    productIds: [],
    conditions: emptyConditions(),
    requirePrepaid: false,
    expiryDays: "90",
    notifyCustomer: true,
    priority: "100",
  };
}

function normalizeConditions(value: unknown): ConditionGroup {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return emptyConditions();
  }

  const raw = value as {
    logic?: unknown;
    rules?: unknown;
  };

  const rules = Array.isArray(raw.rules)
    ? raw.rules
        .filter(
          (item): item is Record<string, unknown> =>
            typeof item === "object" &&
            item !== null &&
            !Array.isArray(item),
        )
        .map((item) => ({
          field: item.field as ConditionField,
          operator: item.operator as ConditionOperator,
          value: String(item.value ?? ""),
        }))
    : [];

  return {
    version: 1,
    logic: raw.logic === "OR" ? "OR" : "AND",
    rules,
  };
}

function legacyProductId(id: string) {
  return id.replace(/^gid:\/\/shopify\/Product\//, "");
}

function formatMoney(
  value: string | number | null | undefined,
  currencyCode: string,
) {
  const amount = Number(value ?? 0);

  if (!Number.isFinite(amount)) return "—";

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toLocaleString()}`;
  }
}

function formatReward(rule: Rule, currency: string) {
  if (rule.rewardType === "PERCENTAGE") {
    return `${rule.percentage ?? "0"}% cashback`;
  }

  return `${formatMoney(rule.fixedAmount, currency)} fixed credit`;
}

function humanize(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function conditionSummary(group: ConditionGroup) {
  if (group.rules.length === 0) return "No additional conditions";

  return `${group.rules.length} condition${
    group.rules.length === 1 ? "" : "s"
  } · Match ${group.logic === "AND" ? "all" : "any"}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  await activateMerchant(shop);

  const [rules, shopResponse] = await Promise.all([
    db.automationRule.findMany({
      where: { shop },
      orderBy: [
        { archivedAt: "asc" },
        { priority: "asc" },
        { createdAt: "desc" },
      ],
    }),

    admin.graphql(`#graphql
      query CreditFlowAutomationSetup {
        shop {
          name
          currencyCode
        }
        products(first: 100, sortKey: TITLE) {
          nodes {
            id
            title
            handle
          }
        }
      }
    `).catch((error: unknown) => {
      console.error(
        "[CreditFlow] Shopify product request failed:",
        error,
      );
      return null;
    }),
  ]);

  let storeName = shop;
  let currencyCode = "INR";
  let products: ProductOption[] = [];

  if (shopResponse) {
    try {
      const response = (await shopResponse.json()) as {
        errors?: Array<{ message?: string }>;
        data?: {
          shop?: {
            name?: string;
            currencyCode?: string;
          };
          products?: {
            nodes?: ProductOption[];
          };
        };
      };

      if (response.errors?.length) {
        console.error(
          "[CreditFlow] Shopify GraphQL errors:",
          response.errors,
        );
      }

      storeName = response.data?.shop?.name || shop;
      currencyCode =
        response.data?.shop?.currencyCode || "INR";
      products = response.data?.products?.nodes || [];
    } catch (error) {
      console.error(
        "[CreditFlow] Unable to process Shopify response:",
        error,
      );
    }
  }

  return {
    storeName,
    currencyCode,
    products,

    rules: rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      description: rule.description,
      enabled: rule.enabled,
      trigger: rule.trigger,
      priority: rule.priority,
      rewardType: rule.rewardType,
      rewardBase: rule.rewardBase,
      percentage: rule.percentage?.toString() ?? null,
      fixedAmount: rule.fixedAmount?.toString() ?? null,
      minimumOrderValue:
        rule.minimumOrderValue?.toString() ?? null,
      maximumReward:
        rule.maximumReward?.toString() ?? null,
      productMode: rule.productMode,
      productIds: (() => {
        try {
          const parsed = JSON.parse(rule.productIds || "[]");
          return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
          return [];
        }
      })(),
      conditions: normalizeConditions(rule.conditions),
      requirePrepaid: rule.requirePrepaid,
      expiryDays: rule.expiryDays,
      notifyCustomer: rule.notifyCustomer,
      createdAt: rule.createdAt.toISOString(),
      archivedAt:
        (rule as typeof rule & { archivedAt?: Date | null }).archivedAt
          ?.toISOString() ?? null,
    })),
  };
};

export default function AutomationsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResponse>();
  const revalidator = useRevalidator();

  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(initialForm());
  const [filter, setFilter] = useState<Filter>("ALL");
  const [search, setSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  const busy = fetcher.state !== "idle";

  const activeRules = data.rules.filter(
    (rule) => !rule.archivedAt && rule.enabled,
  );

  const pausedRules = data.rules.filter(
    (rule) => !rule.archivedAt && !rule.enabled,
  );

  const archivedRules = data.rules.filter(
    (rule) => Boolean(rule.archivedAt),
  );

  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();

    if (!query) return data.products;

    return data.products.filter((product) =>
      `${product.title} ${product.handle}`
        .toLowerCase()
        .includes(query),
    );
  }, [data.products, productSearch]);

  const filteredRules = useMemo(() => {
    const query = search.trim().toLowerCase();

    return data.rules.filter((rule) => {
      const matchesStatus =
        filter === "ALL" ||
        (filter === "ACTIVE" &&
          !rule.archivedAt &&
          rule.enabled) ||
        (filter === "PAUSED" &&
          !rule.archivedAt &&
          !rule.enabled) ||
        (filter === "ARCHIVED" && Boolean(rule.archivedAt));

      const matchesSearch =
        !query ||
        [
          rule.name,
          rule.description ?? "",
          rule.trigger,
          rule.rewardType,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);

      return matchesStatus && matchesSearch;
    });
  }, [data.rules, filter, search]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;

    if (fetcher.data.error) {
      setNotice({
        type: "error",
        message: fetcher.data.error,
      });
      return;
    }

    if (fetcher.data.success) {
      const messages: Record<string, string> = {
        create: "Automation created successfully.",
        update: "Automation updated. Changes apply to future order evaluations.",
        toggle: "Automation status updated.",
        duplicate: "A paused copy of the automation was created.",
        archive: "Automation archived.",
        restore: "Automation restored as paused.",
      };

      setNotice({
        type: "success",
        message:
          messages[fetcher.data.operation ?? ""] ||
          "Automation updated successfully.",
      });

      if (
        fetcher.data.operation === "create" ||
        fetcher.data.operation === "update"
      ) {
        setBuilderOpen(false);
        setEditingRuleId(null);
        setForm(initialForm());
        setStep(1);
      }

      revalidator.revalidate();
    }
  }, [fetcher.data, fetcher.state, revalidator]);

  function sendOperation(payload: Record<string, unknown>) {
    setNotice(null);

    fetcher.submit(JSON.stringify(payload), {
      method: "POST",
      action: "/api/automations",
      encType: "application/json",
    });
  }

  function openCreate() {
    setForm(initialForm());
    setEditingRuleId(null);
    setStep(1);
    setNotice(null);
    setProductSearch("");
    setBuilderOpen(true);
  }

  function openEdit(rule: Rule) {
    setForm({
      name: rule.name,
      description: rule.description ?? "",
      rewardType: rule.rewardType as FormState["rewardType"],
      percentage: rule.percentage ?? "2",
      fixedAmount: rule.fixedAmount ?? "100",
      rewardBase: rule.rewardBase as FormState["rewardBase"],
      minimumOrderValue: rule.minimumOrderValue ?? "",
      maximumReward: rule.maximumReward ?? "",
      productMode: rule.productMode as FormState["productMode"],
      productIds: rule.productIds,
      conditions: normalizeConditions(rule.conditions),
      requirePrepaid: rule.requirePrepaid,
      expiryDays: rule.expiryDays?.toString() ?? "",
      notifyCustomer: rule.notifyCustomer,
      priority: String(rule.priority),
    });

    setEditingRuleId(rule.id);
    setStep(1);
    setNotice(null);
    setProductSearch("");
    setBuilderOpen(true);
  }

  function closeBuilder() {
    if (busy) return;

    setBuilderOpen(false);
    setEditingRuleId(null);
    setStep(1);
  }

  function updateCondition(
    index: number,
    patch: Partial<RuleCondition>,
  ) {
    setForm((current) => ({
      ...current,
      conditions: {
        ...current.conditions,
        rules: current.conditions.rules.map((condition, i) =>
          i === index
            ? { ...condition, ...patch }
            : condition,
        ),
      },
    }));
  }

  function changeConditionField(
    index: number,
    field: ConditionField,
  ) {
    updateCondition(index, {
      field,
      operator: defaultOperator(field),
      value: defaultValue(field),
    });
  }

  function addCondition() {
    if (form.conditions.rules.length >= 20) {
      setNotice({
        type: "error",
        message: "A maximum of 20 conditions is supported per automation.",
      });
      return;
    }

    setForm((current) => ({
      ...current,
      conditions: {
        ...current.conditions,
        rules: [
          ...current.conditions.rules,
          {
            field: "ORDER_SUBTOTAL",
            operator: "GREATER_THAN_OR_EQUAL",
            value: "5000",
          },
        ],
      },
    }));
  }

  function removeCondition(index: number) {
    setForm((current) => ({
      ...current,
      conditions: {
        ...current.conditions,
        rules: current.conditions.rules.filter(
          (_, i) => i !== index,
        ),
      },
    }));
  }

  function toggleProduct(productId: string, checked: boolean) {
    setForm((current) => ({
      ...current,
      productIds: checked
        ? [...current.productIds, productId]
        : current.productIds.filter((id) => id !== productId),
    }));
  }

  function validateStepOne() {
    if (!form.name.trim()) {
      setNotice({
        type: "error",
        message: "Enter an automation name.",
      });
      return false;
    }

    return true;
  }

  function validateStepTwo() {
    if (
      form.minimumOrderValue &&
      (
        !Number.isFinite(Number(form.minimumOrderValue)) ||
        Number(form.minimumOrderValue) < 0
      )
    ) {
      setNotice({
        type: "error",
        message: "Enter a valid minimum order value.",
      });
      return false;
    }

    if (
      form.productMode === "INCLUDE" &&
      form.productIds.length === 0
    ) {
      setNotice({
        type: "error",
        message: "Select at least one product.",
      });
      return false;
    }

    if (
      !Number.isInteger(Number(form.priority)) ||
      Number(form.priority) < 0 ||
      Number(form.priority) > 100000
    ) {
      setNotice({
        type: "error",
        message: "Priority must be between 0 and 100000.",
      });
      return false;
    }

    for (const condition of form.conditions.rules) {
      if (!condition.value.trim()) {
        setNotice({
          type: "error",
          message: "Complete every condition or remove the empty condition.",
        });
        return false;
      }
    }

    return true;
  }

  function saveRule() {
    if (form.rewardType === "PERCENTAGE") {
      const value = Number(form.percentage);

      if (!Number.isFinite(value) || value <= 0 || value > 100) {
        setNotice({
          type: "error",
          message: "Percentage must be greater than 0 and no more than 100.",
        });
        setStep(3);
        return;
      }
    } else {
      const value = Number(form.fixedAmount);

      if (!Number.isFinite(value) || value <= 0) {
        setNotice({
          type: "error",
          message: "Fixed credit must be greater than zero.",
        });
        setStep(3);
        return;
      }
    }

    if (
      form.maximumReward &&
      (
        !Number.isFinite(Number(form.maximumReward)) ||
        Number(form.maximumReward) <= 0
      )
    ) {
      setNotice({
        type: "error",
        message: "Maximum reward must be greater than zero.",
      });
      setStep(3);
      return;
    }

    sendOperation({
      operation: editingRuleId ? "update" : "create",
      ...(editingRuleId ? { ruleId: editingRuleId } : {}),
      name: form.name.trim(),
      description: form.description.trim(),
      trigger: "ORDER_FULFILLED",
      rewardType: form.rewardType,
      rewardBase: form.rewardBase,
      percentage:
        form.rewardType === "PERCENTAGE"
          ? form.percentage
          : null,
      fixedAmount:
        form.rewardType === "FIXED"
          ? form.fixedAmount
          : null,
      minimumOrderValue: form.minimumOrderValue || null,
      maximumReward: form.maximumReward || null,
      productMode: form.productMode,
      productIds: form.productIds,
      conditions: form.conditions,
      requirePrepaid: form.requirePrepaid,
      expiryDays: form.expiryDays || null,
      notifyCustomer: form.notifyCustomer,
      priority: Number(form.priority),
    });
  }

  function duplicateRule(rule: Rule) {
    sendOperation({
      operation: "duplicate",
      ruleId: rule.id,
    });
  }

  function archiveRule(rule: Rule) {
    const confirmed = window.confirm(
      `Archive "${rule.name}"? It will stop being evaluated. Its historical grants and transactions will remain.`,
    );

    if (!confirmed) return;

    sendOperation({
      operation: "archive",
      ruleId: rule.id,
    });
  }

  function restoreRule(rule: Rule) {
    sendOperation({
      operation: "restore",
      ruleId: rule.id,
    });
  }

  function toggleRule(rule: Rule) {
    sendOperation({
      operation: "toggle",
      ruleId: rule.id,
      enabled: !rule.enabled,
    });
  }

  const previewBase = 25000;

  const rawReward =
    form.rewardType === "PERCENTAGE"
      ? previewBase * (Number(form.percentage) || 0) / 100
      : Number(form.fixedAmount) || 0;

  const previewReward = form.maximumReward
    ? Math.min(rawReward, Number(form.maximumReward) || 0)
    : rawReward;

  return (
    <s-page heading="Automations">
      <div className="cfa-page">
        <style>{`
          .cfa-page {
            --ink: #202a26;
            --muted: #78827b;
            --border: #e4e9e5;
            --green: #315b48;
            font-family: system-ui, -apple-system, BlinkMacSystemFont,
              "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            display: grid;
            gap: 19px;
            padding: 8px 0 36px;
            color: var(--ink);
          }

          .cfa-page *,
          .cfa-page *::before,
          .cfa-page *::after {
            box-sizing: border-box;
          }

          .cfa-page button,
          .cfa-page input,
          .cfa-page select,
          .cfa-page textarea {
            font: inherit;
          }

          .cfa-page button { cursor: pointer; }
          .cfa-page button:disabled { opacity: .55; cursor: not-allowed; }

          .cfa-head {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 15px;
          }

          .cfa-kicker {
            color: #7b867e;
            font-size: 10px;
            font-weight: 650;
            letter-spacing: .07em;
            text-transform: uppercase;
          }

          .cfa-title {
            margin: 5px 0;
            font-size: clamp(22px, 2.4vw, 26px);
            line-height: 1.2;
            font-weight: 700;
            letter-spacing: -.6px;
          }

          .cfa-subtitle {
            margin: 0;
            color: var(--muted);
            font-size: 12px;
            line-height: 1.5;
          }

          .cfa-button {
            min-height: 35px;
            padding: 8px 12px;
            border: 1px solid #dce2dd;
            border-radius: 7px;
            background: #fff;
            color: #344039;
            font-size: 11px;
            font-weight: 630;
            transition: background .15s ease, border-color .15s ease;
          }

          .cfa-button:hover {
            background: #f6f8f6;
            border-color: #cbd5ce;
          }

          .cfa-button--primary {
            background: var(--ink);
            color: #fff;
            border-color: var(--ink);
          }

          .cfa-button--primary:hover {
            background: #35483d;
            border-color: #35483d;
            color: #fff;
          }

          .cfa-button--quiet {
            min-height: 28px;
            padding: 5px 8px;
            font-size: 10px;
          }

          .cfa-button--danger {
            color: #9b4639;
          }

          .cfa-stats {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 11px;
          }

          .cfa-stat {
            padding: 14px 16px;
            background: #fff;
            border: 1px solid var(--border);
            border-radius: 10px;
          }

          .cfa-stat-label {
            margin-bottom: 8px;
            color: var(--muted);
            font-size: 11px;
          }

          .cfa-stat-value {
            font-size: 23px;
            font-weight: 700;
            letter-spacing: -.5px;
            line-height: 1.2;
          }

          .cfa-stat-note {
            margin-top: 5px;
            color: #8b958d;
            font-size: 10px;
          }

          .cfa-info {
            display: flex;
            align-items: flex-start;
            gap: 9px;
            padding: 10px 12px;
            border: 1px solid #e4eae5;
            border-radius: 8px;
            background: #f8faf8;
            color: #637066;
            font-size: 10px;
            line-height: 1.55;
          }

          .cfa-info-mark {
            flex: 0 0 18px;
            width: 18px;
            height: 18px;
            display: grid;
            place-items: center;
            border-radius: 50%;
            background: #e8efe9;
            color: var(--green);
            font-weight: 700;
          }

          .cfa-tools {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
          }

          .cfa-search {
            width: min(300px, 100%);
            min-height: 35px;
            padding: 8px 10px;
            border: 1px solid #dce2dd;
            border-radius: 7px;
            background: #fff;
            color: var(--ink);
            font-size: 11px;
          }

          .cfa-tabs {
            display: flex;
            gap: 3px;
            padding: 3px;
            border-radius: 8px;
            background: #f0f3f0;
          }

          .cfa-tab {
            min-height: 27px;
            padding: 5px 10px;
            border: 0;
            border-radius: 6px;
            background: transparent;
            color: #69736c;
            font-size: 10px;
            font-weight: 620;
          }

          .cfa-tab[aria-pressed="true"] {
            background: #fff;
            color: #25342b;
            box-shadow: 0 1px 3px #17251a12;
          }

          .cfa-list {
            overflow: hidden;
            background: #fff;
            border: 1px solid var(--border);
            border-radius: 10px;
          }

          .cfa-list-head {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            padding: 14px 16px;
            border-bottom: 1px solid #edf0ed;
          }

          .cfa-list-title {
            font-size: 12px;
            font-weight: 680;
          }

          .cfa-muted {
            color: #89928b;
            font-size: 10px;
          }

          .cfa-table-wrap { overflow-x: auto; }

          .cfa-table {
            width: 100%;
            min-width: 930px;
            border-collapse: collapse;
            font-size: 11px;
          }

          .cfa-table th {
            padding: 10px 12px;
            border-bottom: 1px solid #edf0ed;
            background: #fafbfa;
            color: #879088;
            text-align: left;
            text-transform: uppercase;
            letter-spacing: .045em;
            font-size: 9px;
            font-weight: 680;
            white-space: nowrap;
          }

          .cfa-table td {
            padding: 12px;
            border-bottom: 1px solid #f0f2f0;
            vertical-align: middle;
          }

          .cfa-table tbody tr:last-child td { border-bottom: 0; }

          .cfa-rule-name {
            color: #29332d;
            font-size: 11px;
            font-weight: 680;
          }

          .cfa-rule-desc {
            max-width: 190px;
            margin-top: 3px;
            color: #8a938c;
            font-size: 9px;
            line-height: 1.4;
          }

          .cfa-status {
            display: inline-flex;
            align-items: center;
            padding: 4px 7px;
            border-radius: 20px;
            background: #edf5ef;
            color: #2e6848;
            font-size: 9px;
            font-weight: 650;
            white-space: nowrap;
          }

          .cfa-status--paused {
            background: #f0f2f0;
            color: #6e786f;
          }

          .cfa-status--archived {
            background: #f8eeee;
            color: #87534d;
          }

          .cfa-actions {
            display: flex;
            align-items: center;
            gap: 5px;
          }

          .cfa-switch {
            width: 33px;
            height: 19px;
            padding: 2px;
            display: inline-flex;
            align-items: center;
            border: 0;
            border-radius: 20px;
            background: #cbd2cd;
          }

          .cfa-switch[aria-checked="true"] {
            justify-content: flex-end;
            background: var(--green);
          }

          .cfa-switch[aria-checked="false"] {
            justify-content: flex-start;
          }

          .cfa-switch span {
            width: 15px;
            height: 15px;
            border-radius: 50%;
            background: #fff;
            box-shadow: 0 1px 2px #0002;
          }

          .cfa-empty {
            padding: 42px 18px;
            text-align: center;
          }

          .cfa-empty-mark {
            width: 39px;
            height: 39px;
            display: grid;
            place-items: center;
            margin: 0 auto 11px;
            border-radius: 10px;
            background: #edf2ee;
            color: var(--green);
            font-size: 17px;
          }

          .cfa-empty-title {
            margin-bottom: 5px;
            font-size: 13px;
            font-weight: 700;
          }

          .cfa-empty-text {
            max-width: 390px;
            margin: 0 auto 14px;
            color: #7d8780;
            font-size: 10px;
            line-height: 1.55;
          }

          .cfa-notice {
            padding: 10px 12px;
            border-radius: 8px;
            font-size: 11px;
            line-height: 1.5;
          }

          .cfa-notice--success {
            border: 1px solid #d6e7d9;
            background: #f0f7f1;
            color: #286344;
          }

          .cfa-notice--error {
            border: 1px solid #efd8d3;
            background: #fff4f2;
            color: #984337;
          }

          /* Builder */

          .cfa-overlay {
            position: fixed;
            z-index: 1000;
            inset: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 15px;
            background: #121b164d;
          }

          .cfa-modal {
            display: flex;
            flex-direction: column;
            width: min(700px, 100%);
            max-height: 92vh;
            overflow: hidden;
            border: 1px solid #e3e8e4;
            border-radius: 12px;
            background: #fff;
            box-shadow: 0 18px 60px #101b1425;
          }

          .cfa-modal-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 16px 19px;
            border-bottom: 1px solid #edf0ed;
          }

          .cfa-modal-title {
            font-size: 15px;
            font-weight: 700;
          }

          .cfa-modal-subtitle {
            margin-top: 3px;
            color: #808a82;
            font-size: 10px;
          }

          .cfa-close {
            width: 28px;
            height: 28px;
            border: 0;
            border-radius: 50%;
            background: #f0f2f0;
            color: #59635c;
            font-size: 18px;
          }

          .cfa-progress {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
            padding: 12px 19px 0;
          }

          .cfa-progress-item {
            display: flex;
            align-items: center;
            gap: 7px;
            min-width: 0;
            padding-bottom: 8px;
            border-bottom: 2px solid #e9ede9;
            color: #879088;
            font-size: 10px;
            font-weight: 620;
          }

          .cfa-progress-item--active {
            border-color: var(--green);
            color: var(--green);
          }

          .cfa-step-dot {
            flex: 0 0 19px;
            width: 19px;
            height: 19px;
            display: grid;
            place-items: center;
            border-radius: 50%;
            background: #eef1ee;
            font-size: 9px;
          }

          .cfa-progress-item--active .cfa-step-dot {
            background: var(--green);
            color: #fff;
          }

          .cfa-modal-body {
            overflow: auto;
            padding: 17px 19px 19px;
          }

          .cfa-step-heading {
            margin-bottom: 4px;
            font-size: 13px;
            font-weight: 700;
          }

          .cfa-step-help {
            margin-bottom: 15px;
            color: #7f8981;
            font-size: 10px;
            line-height: 1.5;
          }

          .cfa-form-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
          }

          .cfa-field {
            display: grid;
            align-content: start;
            gap: 6px;
            min-width: 0;
          }

          .cfa-field--full { grid-column: 1 / -1; }

          .cfa-label {
            color: #465148;
            font-size: 10px;
            font-weight: 680;
          }

          .cfa-field input:not([type="checkbox"]),
          .cfa-field select,
          .cfa-field textarea {
            width: 100%;
            min-height: 35px;
            margin: 0;
            padding: 8px 10px;
            border: 1px solid #dce3de;
            border-radius: 7px;
            background: #fff;
            color: #29332c;
            font-size: 11px;
            line-height: 1.4;
          }

          .cfa-field textarea {
            min-height: 57px;
            resize: vertical;
          }

          .cfa-help {
            color: #8a938c;
            font-size: 9px;
            line-height: 1.45;
          }

          /* Fixed-size checkbox dimensions: no inherited full-width inputs. */

          .cfa-page input[type="checkbox"] {
            appearance: auto;
            -webkit-appearance: checkbox;
            flex: 0 0 16px;
            width: 16px;
            min-width: 16px;
            max-width: 16px;
            height: 16px;
            min-height: 16px;
            margin: 1px 0 0;
            padding: 0;
            border: initial;
            accent-color: var(--green);
            cursor: pointer;
          }

          .cfa-check-row {
            display: flex;
            align-items: flex-start;
            gap: 9px;
            padding: 10px 11px;
            border: 1px solid #e4e9e5;
            border-radius: 8px;
          }

          .cfa-check-content { min-width: 0; }

          .cfa-check-title {
            color: #3c4940;
            font-size: 10px;
            font-weight: 680;
          }

          .cfa-check-help {
            margin-top: 3px;
            color: #869088;
            font-size: 9px;
            line-height: 1.45;
          }

          .cfa-trigger {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 11px;
            border: 1px solid #dce8df;
            border-radius: 8px;
            background: #f8faf8;
          }

          .cfa-trigger-title {
            font-size: 11px;
            font-weight: 680;
          }

          .cfa-trigger-help {
            margin-top: 3px;
            color: #819087;
            font-size: 9px;
            line-height: 1.45;
          }

          .cfa-condition-list {
            display: grid;
            gap: 8px;
          }

          .cfa-condition-row {
            display: grid;
            grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1fr) 28px;
            align-items: center;
            gap: 7px;
            padding: 9px;
            border: 1px solid #e5e9e6;
            border-radius: 8px;
            background: #fff;
          }

          .cfa-condition-row select,
          .cfa-condition-row input {
            width: 100%;
            min-width: 0;
            height: 33px;
            padding: 6px 8px;
            border: 1px solid #dce3de;
            border-radius: 6px;
            background: #fff;
            color: #344039;
            font-size: 10px;
          }

          .cfa-remove {
            width: 27px;
            height: 27px;
            border: 0;
            border-radius: 6px;
            background: #f5f2f1;
            color: #8c5a51;
            font-size: 15px;
          }

          .cfa-group-logic {
            display: flex;
            align-items: center;
            gap: 7px;
            flex-wrap: wrap;
            margin-bottom: 9px;
          }

          .cfa-logic-btn {
            min-height: 28px;
            padding: 5px 10px;
            border: 1px solid #dce3de;
            border-radius: 6px;
            background: #fff;
            color: #68746b;
            font-size: 10px;
            font-weight: 620;
          }

          .cfa-logic-btn[aria-pressed="true"] {
            background: #edf4ef;
            border-color: #c8d8cd;
            color: #285d43;
          }

          .cfa-product-box {
            border: 1px solid #e1e6e2;
            border-radius: 8px;
            overflow: hidden;
          }

          .cfa-product-search { padding: 8px; border-bottom: 1px solid #edf0ed; }

          .cfa-product-search input {
            width: 100%;
            min-height: 31px;
            padding: 7px 9px;
            border: 1px solid #dce3de;
            border-radius: 6px;
            font-size: 10px;
          }

          .cfa-product-list {
            max-height: 160px;
            overflow-y: auto;
          }

          .cfa-product-item {
            display: flex;
            align-items: flex-start;
            gap: 9px;
            padding: 8px 10px;
            border-bottom: 1px solid #f0f2f0;
            cursor: pointer;
          }

          .cfa-product-item:last-child { border-bottom: 0; }

          .cfa-product-name {
            color: #354138;
            font-size: 10px;
            line-height: 1.4;
          }

          .cfa-product-handle {
            margin-top: 2px;
            color: #939b95;
            font-size: 9px;
          }

          .cfa-preview {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 11px;
            border: 1px solid #e3eae4;
            border-radius: 8px;
            background: #f7faf7;
          }

          .cfa-preview-label {
            margin-bottom: 4px;
            color: #849087;
            font-size: 9px;
          }

          .cfa-preview-description {
            font-size: 10px;
            font-weight: 650;
          }

          .cfa-preview-amount {
            color: #286449;
            font-size: 19px;
            font-weight: 730;
            white-space: nowrap;
          }

          .cfa-modal-foot {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 11px 19px;
            border-top: 1px solid #edf0ed;
          }

          .cfa-foot-actions {
            display: flex;
            gap: 7px;
            align-items: center;
          }

          @media (max-width: 720px) {
            .cfa-stats { grid-template-columns: 1fr; gap: 8px; }
            .cfa-stat { padding: 11px 13px; }
            .cfa-stat-value { font-size: 21px; }
            .cfa-form-grid { grid-template-columns: 1fr; }
            .cfa-field--full { grid-column: auto; }
          }

          @media (max-width: 560px) {
            .cfa-condition-row {
              grid-template-columns: 1fr 1fr;
            }

            .cfa-condition-row select:first-child {
              grid-column: 1 / -1;
            }

            .cfa-condition-row .cfa-remove {
              justify-self: end;
            }

            .cfa-modal {
              max-height: 96vh;
            }

            .cfa-modal-head,
            .cfa-modal-body,
            .cfa-modal-foot {
              padding-left: 13px;
              padding-right: 13px;
            }

            .cfa-progress {
              padding-left: 13px;
              padding-right: 13px;
            }

            .cfa-progress-item {
              gap: 4px;
              font-size: 9px;
            }

            .cfa-tools { align-items: stretch; }
            .cfa-search { width: 100%; }
          }

          @media (prefers-reduced-motion: reduce) {
            .cfa-page * {
              transition: none !important;
              animation: none !important;
            }
          }
        `}</style>

        <header className="cfa-head">
          <div>
            <div className="cfa-kicker">Reward management</div>
            <h1 className="cfa-title">Automations</h1>
            <p className="cfa-subtitle">
              Manage reward programs and decide which customers qualify.
            </p>
          </div>

          <button
            className="cfa-button cfa-button--primary"
            onClick={openCreate}
          >
            + Create automation
          </button>
        </header>

        {notice && (
          <div
            className={`cfa-notice ${
              notice.type === "success"
                ? "cfa-notice--success"
                : "cfa-notice--error"
            }`}
            role="status"
          >
            {notice.message}
          </div>
        )}

        <section className="cfa-stats">
          <article className="cfa-stat">
            <div className="cfa-stat-label">Total programs</div>
            <div className="cfa-stat-value">
              {data.rules.filter((rule) => !rule.archivedAt).length}
            </div>
            <div className="cfa-stat-note">Non-archived rules</div>
          </article>

          <article className="cfa-stat">
            <div className="cfa-stat-label">Active</div>
            <div className="cfa-stat-value">{activeRules.length}</div>
            <div className="cfa-stat-note">Enabled rules</div>
          </article>

          <article className="cfa-stat">
            <div className="cfa-stat-label">Paused</div>
            <div className="cfa-stat-value">{pausedRules.length}</div>
            <div className="cfa-stat-note">Temporarily disabled</div>
          </article>
        </section>

        <div className="cfa-info">
          <span className="cfa-info-mark">i</span>
          <span>
            <strong>Current trigger:</strong> Order fulfilled.
            Rules run by priority, lowest number first. The first matching
            rule wins; rewards do not stack. Editing affects future order
            evaluations only.
          </span>
        </div>

        <div className="cfa-tools">
          <input
            className="cfa-search"
            type="search"
            placeholder="Search reward programs..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search automations"
          />

          <div className="cfa-tabs" aria-label="Filter automations">
            {([
              ["ALL", "All"],
              ["ACTIVE", "Active"],
              ["PAUSED", "Paused"],
              ["ARCHIVED", "Archived"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className="cfa-tab"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <section className="cfa-list">
          <div className="cfa-list-head">
            <div className="cfa-list-title">Reward programs</div>
            <span className="cfa-muted">
              {filteredRules.length} shown
            </span>
          </div>

          {filteredRules.length === 0 ? (
            <div className="cfa-empty">
              <div className="cfa-empty-mark">✦</div>
              <div className="cfa-empty-title">
                {data.rules.length === 0
                  ? "Create your first reward program"
                  : "No matching programs"}
              </div>
              <p className="cfa-empty-text">
                {data.rules.length === 0
                  ? "Create a trigger, qualifying conditions and a store-credit reward."
                  : "Try a different search or filter."}
              </p>
              {data.rules.length === 0 && (
                <button
                  className="cfa-button cfa-button--primary"
                  onClick={openCreate}
                >
                  Create automation
                </button>
              )}
            </div>
          ) : (
            <div className="cfa-table-wrap">
              <table className="cfa-table">
                <thead>
                  <tr>
                    <th>Program</th>
                    <th>Trigger</th>
                    <th>Reward</th>
                    <th>Conditions</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredRules.map((rule) => {
                    const archived = Boolean(rule.archivedAt);

                    return (
                      <tr key={rule.id}>
                        <td>
                          <div className="cfa-rule-name">{rule.name}</div>
                          {rule.description && (
                            <div className="cfa-rule-desc">
                              {rule.description}
                            </div>
                          )}
                          <div className="cfa-muted" style={{ marginTop: 3 }}>
                            Created {shortDate(rule.createdAt)}
                          </div>
                        </td>

                        <td>{humanize(rule.trigger)}</td>

                        <td>{formatReward(rule, data.currencyCode)}</td>

                        <td>{conditionSummary(rule.conditions)}</td>

                        <td>{rule.priority}</td>

                        <td>
                          <span
                            className={`cfa-status ${
                              archived
                                ? "cfa-status--archived"
                                : rule.enabled
                                  ? ""
                                  : "cfa-status--paused"
                            }`}
                          >
                            {archived
                              ? "Archived"
                              : rule.enabled
                                ? "Active"
                                : "Paused"}
                          </span>
                        </td>

                        <td>
                          <div className="cfa-actions">
                            {!archived ? (
                              <>
                                <button
                                  className="cfa-button cfa-button--quiet"
                                  disabled={busy}
                                  onClick={() => openEdit(rule)}
                                >
                                  Edit
                                </button>

                                <button
                                  className="cfa-button cfa-button--quiet"
                                  disabled={busy}
                                  onClick={() => duplicateRule(rule)}
                                >
                                  Copy
                                </button>

                                <button
                                  type="button"
                                  className="cfa-switch"
                                  role="switch"
                                  aria-checked={rule.enabled}
                                  aria-label={`${
                                    rule.enabled ? "Pause" : "Enable"
                                  } ${rule.name}`}
                                  disabled={busy}
                                  onClick={() => toggleRule(rule)}
                                >
                                  <span />
                                </button>

                                <button
                                  className="cfa-button cfa-button--quiet cfa-button--danger"
                                  disabled={busy}
                                  onClick={() => archiveRule(rule)}
                                >
                                  Archive
                                </button>
                              </>
                            ) : (
                              <button
                                className="cfa-button cfa-button--quiet"
                                disabled={busy}
                                onClick={() => restoreRule(rule)}
                              >
                                Restore
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {builderOpen && (
          <div
            className="cfa-overlay"
            role="presentation"
            onMouseDown={(event) => {
              if (
                event.target === event.currentTarget &&
                !busy
              ) {
                closeBuilder();
              }
            }}
          >
            <section
              className="cfa-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="cfa-dialog-title"
            >
              <header className="cfa-modal-head">
                <div>
                  <div className="cfa-modal-title" id="cfa-dialog-title">
                    {editingRuleId ? "Edit automation" : "Create automation"}
                  </div>
                  <div className="cfa-modal-subtitle">
                    Configure the trigger, conditions and reward.
                  </div>
                </div>

                <button
                  className="cfa-close"
                  onClick={closeBuilder}
                  disabled={busy}
                  aria-label="Close"
                >
                  ×
                </button>
              </header>

              <div className="cfa-progress">
                {[
                  ["1", "Trigger"],
                  ["2", "Conditions"],
                  ["3", "Reward"],
                ].map(([number, label], index) => (
                  <div
                    key={number}
                    className={`cfa-progress-item ${
                      step === index + 1
                        ? "cfa-progress-item--active"
                        : ""
                    }`}
                  >
                    <span className="cfa-step-dot">{number}</span>
                    {label}
                  </div>
                ))}
              </div>

              <div className="cfa-modal-body">
                {step === 1 && (
                  <>
                    <div className="cfa-step-heading">
                      Choose the trigger
                    </div>
                    <div className="cfa-step-help">
                      This event starts the reward evaluation.
                    </div>

                    <div className="cfa-form-grid">
                      <div className="cfa-field cfa-field--full">
                        <label className="cfa-label" htmlFor="cf-name">
                          Program name
                        </label>
                        <input
                          id="cf-name"
                          maxLength={100}
                          value={form.name}
                          onChange={(event) =>
                            setForm({ ...form, name: event.target.value })
                          }
                          placeholder="e.g. 2% cashback on orders"
                        />
                      </div>

                      <div className="cfa-field cfa-field--full">
                        <label className="cfa-label" htmlFor="cf-description">
                          Description <span className="cfa-muted">(optional)</span>
                        </label>
                        <textarea
                          id="cf-description"
                          maxLength={500}
                          value={form.description}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              description: event.target.value,
                            })
                          }
                          placeholder="Explain the purpose of this reward."
                        />
                      </div>

                      <div className="cfa-field cfa-field--full">
                        <span className="cfa-label">Trigger event</span>
                        <div className="cfa-trigger">
                          <div>
                            <div className="cfa-trigger-title">
                              Order fulfilled
                            </div>
                            <div className="cfa-trigger-help">
                              Reward evaluation runs after the order is fully fulfilled.
                            </div>
                          </div>
                          <span className="cfa-status">Default</span>
                        </div>
                        <span className="cfa-help">
                          Other triggers will be enabled when their event processors
                          are implemented and tested.
                        </span>
                      </div>
                    </div>
                  </>
                )}

                {step === 2 && (
                  <>
                    <div className="cfa-step-heading">
                      Define qualifying conditions
                    </div>
                    <div className="cfa-step-help">
                      All conditions in this group must match when AND is selected.
                      At least one must match when OR is selected.
                    </div>

                    <div className="cfa-form-grid">
                      <div className="cfa-field">
                        <label className="cfa-label" htmlFor="cf-minimum">
                          Minimum order value ({data.currencyCode})
                        </label>
                        <input
                          id="cf-minimum"
                          type="number"
                          min="0"
                          step="0.01"
                          value={form.minimumOrderValue}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              minimumOrderValue: event.target.value,
                            })
                          }
                          placeholder="No minimum"
                        />
                        <span className="cfa-help">
                          The built-in minimum order threshold.
                        </span>
                      </div>

                      <div className="cfa-field">
                        <label className="cfa-label" htmlFor="cf-product-mode">
                          Product eligibility
                        </label>
                        <select
                          id="cf-product-mode"
                          value={form.productMode}
                          onChange={(event) => {
                            const productMode =
                              event.target.value as FormState["productMode"];

                            setForm({
                              ...form,
                              productMode,
                              productIds:
                                productMode === "ALL" ? [] : form.productIds,
                              rewardBase:
                                productMode === "ALL"
                                  ? form.rewardBase
                                  : "ELIGIBLE_ITEMS",
                            });
                          }}
                        >
                          <option value="ALL">All products</option>
                          <option value="INCLUDE">Selected products only</option>
                          <option value="EXCLUDE">Exclude selected products</option>
                        </select>
                      </div>

                      {form.productMode !== "ALL" && (
                        <div className="cfa-field cfa-field--full">
                          <span className="cfa-label">
                            Select products ({form.productIds.length})
                          </span>

                          <div className="cfa-product-box">
                            <div className="cfa-product-search">
                              <input
                                type="search"
                                value={productSearch}
                                onChange={(event) =>
                                  setProductSearch(event.target.value)
                                }
                                placeholder="Search products..."
                              />
                            </div>

                            <div className="cfa-product-list">
                              {filteredProducts.length === 0 ? (
                                <div className="cfa-empty">
                                  {data.products.length === 0
                                    ? "Products are unavailable. Check read_products access and Shopify connectivity."
                                    : "No matching products."}
                                </div>
                              ) : (
                                filteredProducts.map((product) => {
                                  const id = legacyProductId(product.id);

                                  return (
                                    <label
                                      className="cfa-product-item"
                                      key={product.id}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={form.productIds.includes(id)}
                                        onChange={(event) =>
                                          toggleProduct(id, event.target.checked)
                                        }
                                      />
                                      <span>
                                        <span className="cfa-product-name">
                                          {product.title}
                                        </span>
                                        <span className="cfa-product-handle">
                                          /{product.handle}
                                        </span>
                                      </span>
                                    </label>
                                  );
                                })
                              )}
                            </div>
                          </div>

                          <span className="cfa-help">
                            The selector currently loads up to 100 products.
                            Collection selection is a later extension.
                          </span>
                        </div>
                      )}

                      <div className="cfa-field cfa-field--full">
                        <label className="cfa-label" htmlFor="cf-base">
                          Calculate reward on
                        </label>
                        <select
                          id="cf-base"
                          value={form.rewardBase}
                          disabled={form.productMode !== "ALL"}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              rewardBase: event.target.value as FormState["rewardBase"],
                            })
                          }
                        >
                          <option value="ORDER_SUBTOTAL">
                            Entire order subtotal
                          </option>
                          <option value="ELIGIBLE_ITEMS">
                            Eligible product subtotal
                          </option>
                        </select>
                      </div>

                      <div className="cfa-field cfa-field--full">
                        <label className="cfa-check-row">
                          <input
                            type="checkbox"
                            checked={form.requirePrepaid}
                            onChange={(event) =>
                              setForm({
                                ...form,
                                requirePrepaid: event.target.checked,
                              })
                            }
                          />
                          <span className="cfa-check-content">
                            <span className="cfa-check-title">
                              Prepaid orders only
                            </span>
                            <span className="cfa-check-help">
                              Restrict the reward to orders identified as paid and
                              not using a COD gateway.
                            </span>
                          </span>
                        </label>
                      </div>

                      <div className="cfa-field cfa-field--full">
                        <div className="cfa-group-logic">
                          <span className="cfa-label">Condition matching</span>
                          <button
                            type="button"
                            className="cfa-logic-btn"
                            aria-pressed={form.conditions.logic === "AND"}
                            onClick={() =>
                              setForm({
                                ...form,
                                conditions: {
                                  ...form.conditions,
                                  logic: "AND",
                                },
                              })
                            }
                          >
                            Match all (AND)
                          </button>
                          <button
                            type="button"
                            className="cfa-logic-btn"
                            aria-pressed={form.conditions.logic === "OR"}
                            onClick={() =>
                              setForm({
                                ...form,
                                conditions: {
                                  ...form.conditions,
                                  logic: "OR",
                                },
                              })
                            }
                          >
                            Match any (OR)
                          </button>
                        </div>

                        {form.conditions.rules.length > 0 ? (
                          <div className="cfa-condition-list">
                            {form.conditions.rules.map((condition, index) => (
                              <div className="cfa-condition-row" key={index}>
                                <select
                                  aria-label={`Condition ${index + 1} field`}
                                  value={condition.field}
                                  onChange={(event) =>
                                    changeConditionField(
                                      index,
                                      event.target.value as ConditionField,
                                    )
                                  }
                                >
                                  {CONDITION_FIELDS.map((field) => (
                                    <option key={field.value} value={field.value}>
                                      {field.label}
                                    </option>
                                  ))}
                                </select>

                                <select
                                  aria-label={`Condition ${index + 1} operator`}
                                  value={condition.operator}
                                  onChange={(event) =>
                                    updateCondition(index, {
                                      operator: event.target.value as ConditionOperator,
                                    })
                                  }
                                >
                                  {operatorsForField(condition.field).map((operator) => (
                                    <option key={operator} value={operator}>
                                      {humanize(operator)}
                                    </option>
                                  ))}
                                </select>

                                {condition.field === "PAYMENT_STATUS" ? (
                                  <select
                                    aria-label={`Condition ${index + 1} value`}
                                    value={condition.value}
                                    onChange={(event) =>
                                      updateCondition(index, {
                                        value: event.target.value,
                                      })
                                    }
                                  >
                                    <option value="PREPAID">Prepaid</option>
                                    <option value="COD">COD</option>
                                    <option value="UNKNOWN">Unknown</option>
                                  </select>
                                ) : (
                                  <input
                                    aria-label={`Condition ${index + 1} value`}
                                    type={
                                      NUMERIC_FIELDS.has(condition.field)
                                        ? "number"
                                        : "text"
                                    }
                                    min={
                                      NUMERIC_FIELDS.has(condition.field)
                                        ? "0"
                                        : undefined
                                    }
                                    step={
                                      condition.field === "ORDER_SUBTOTAL"
                                        ? "0.01"
                                        : "1"
                                    }
                                    placeholder={
                                      condition.field === "SHIPPING_COUNTRY"
                                        ? "e.g. IN"
                                        : "Value"
                                    }
                                    value={condition.value}
                                    onChange={(event) =>
                                      updateCondition(index, {
                                        value: event.target.value,
                                      })
                                    }
                                  />
                                )}

                                <button
                                  className="cfa-remove"
                                  type="button"
                                  aria-label={`Remove condition ${index + 1}`}
                                  onClick={() => removeCondition(index)}
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="cfa-info">
                            No additional condition group. The rule will use
                            the minimum order, product and payment settings above.
                          </div>
                        )}

                        <div style={{ marginTop: 9 }}>
                          <button
                            type="button"
                            className="cfa-button"
                            onClick={addCondition}
                            disabled={form.conditions.rules.length >= 20}
                          >
                            + Add condition
                          </button>
                        </div>
                      </div>

                      <div className="cfa-field cfa-field--full">
                        <details style={{
                          border: "1px solid #e5e9e6",
                          borderRadius: 8,
                          padding: 10,
                        }}>
                          <summary style={{
                            color: "#4e5b52",
                            fontSize: 10,
                            fontWeight: 680,
                            cursor: "pointer",
                          }}>
                            Advanced rule settings
                          </summary>

                          <div className="cfa-field" style={{ marginTop: 12 }}>
                            <label className="cfa-label" htmlFor="cf-priority">
                              Rule priority
                            </label>
                            <input
                              id="cf-priority"
                              type="number"
                              min="0"
                              max="100000"
                              step="1"
                              value={form.priority}
                              onChange={(event) =>
                                setForm({
                                  ...form,
                                  priority: event.target.value,
                                })
                              }
                            />
                            <span className="cfa-help">
                              Lower numbers run first. Only the first matching
                              rule awards a reward.
                            </span>
                          </div>
                        </details>
                      </div>
                    </div>
                  </>
                )}

                {step === 3 && (
                  <>
                    <div className="cfa-step-heading">
                      Configure the reward
                    </div>
                    <div className="cfa-step-help">
                      Decide how much Shopify store credit qualifying customers receive.
                    </div>

                    <div className="cfa-form-grid">
                      <div className="cfa-field">
                        <label className="cfa-label" htmlFor="cf-type">
                          Reward type
                        </label>
                        <select
                          id="cf-type"
                          value={form.rewardType}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              rewardType: event.target.value as FormState["rewardType"],
                            })
                          }
                        >
                          <option value="PERCENTAGE">Percentage cashback</option>
                          <option value="FIXED">Fixed store credit</option>
                        </select>
                      </div>

                      <div className="cfa-field">
                        <label className="cfa-label" htmlFor="cf-value">
                          {form.rewardType === "PERCENTAGE"
                            ? "Cashback percentage (%)"
                            : `Credit amount (${data.currencyCode})`}
                        </label>
                        <input
                          id="cf-value"
                          type="number"
                          min="0.01"
                          step="0.01"
                          max={
                            form.rewardType === "PERCENTAGE"
                              ? "100"
                              : undefined
                          }
                          value={
                            form.rewardType === "PERCENTAGE"
                              ? form.percentage
                              : form.fixedAmount
                          }
                          onChange={(event) =>
                            setForm({
                              ...form,
                              ...(form.rewardType === "PERCENTAGE"
                                ? { percentage: event.target.value }
                                : { fixedAmount: event.target.value }),
                            })
                          }
                        />
                      </div>

                      <div className="cfa-field">
                        <label className="cfa-label" htmlFor="cf-cap">
                          Maximum reward ({data.currencyCode})
                        </label>
                        <input
                          id="cf-cap"
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={form.maximumReward}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              maximumReward: event.target.value,
                            })
                          }
                          placeholder="No cap"
                        />
                      </div>

                      <div className="cfa-field">
                        <label className="cfa-label" htmlFor="cf-expiry">
                          Credit expiry
                        </label>
                        <select
                          id="cf-expiry"
                          value={form.expiryDays}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              expiryDays: event.target.value,
                            })
                          }
                        >
                          <option value="">Never expires</option>
                          <option value="30">30 days</option>
                          <option value="60">60 days</option>
                          <option value="90">90 days</option>
                          <option value="180">180 days</option>
                          <option value="365">365 days</option>
                          <option value="730">2 years</option>
                        </select>
                      </div>

                      <div className="cfa-field cfa-field--full">
                        <label className="cfa-check-row">
                          <input
                            type="checkbox"
                            checked={form.notifyCustomer}
                            onChange={(event) =>
                              setForm({
                                ...form,
                                notifyCustomer: event.target.checked,
                              })
                            }
                          />
                          <span className="cfa-check-content">
                            <span className="cfa-check-title">
                              Notify customer when credit is issued
                            </span>
                            <span className="cfa-check-help">
                              Use Shopify's native store-credit notification
                              where supported.
                            </span>
                          </span>
                        </label>
                      </div>

                      <div className="cfa-field cfa-field--full">
                        <div className="cfa-preview">
                          <div>
                            <div className="cfa-preview-label">
                              Example reward on{" "}
                              {formatMoney(25000, data.currencyCode)}
                            </div>
                            <div className="cfa-preview-description">
                              {form.rewardType === "PERCENTAGE"
                                ? `${form.percentage || "0"}% cashback`
                                : "Fixed credit reward"}
                            </div>
                          </div>

                          <div className="cfa-preview-amount">
                            {formatMoney(
                              Math.max(0, previewReward),
                              data.currencyCode,
                            )}
                          </div>
                        </div>

                        <span className="cfa-help">
                          Illustrative calculation. Actual rewards use the
                          qualifying order's values and currency.
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <footer className="cfa-modal-foot">
                <button
                  className="cfa-button"
                  onClick={closeBuilder}
                  disabled={busy}
                >
                  Cancel
                </button>

                <div className="cfa-foot-actions">
                  {step > 1 && (
                    <button
                      className="cfa-button"
                      disabled={busy}
                      onClick={() => {
                        setNotice(null);
                        setStep((current) => current - 1);
                      }}
                    >
                      Back
                    </button>
                  )}

                  {step < 3 ? (
                    <button
                      className="cfa-button cfa-button--primary"
                      onClick={() => {
                        const valid =
                          step === 1
                            ? validateStepOne()
                            : validateStepTwo();

                        if (valid) {
                          setNotice(null);
                          setStep((current) => current + 1);
                        }
                      }}
                    >
                      Continue
                    </button>
                  ) : (
                    <button
                      className="cfa-button cfa-button--primary"
                      onClick={saveRule}
                      disabled={busy}
                    >
                      {busy
                        ? "Saving..."
                        : editingRuleId
                          ? "Save changes"
                          : "Create automation"}
                    </button>
                  )}
                </div>
              </footer>
            </section>
          </div>
        )}
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
