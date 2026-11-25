import { Prisma } from "@prisma/client";
import type { CreditGrant, PrismaClient } from "@prisma/client";
import type { authenticate } from "../shopify.server";

import {
  calculateEligibleLineSubtotal,
  calculateReward,
  evaluateRuleConditions,
} from "../domain/reward-engine.mjs";
import { createAutomationRuleSnapshot } from "../domain/automation-rule-snapshot.mjs";
import {
  buildAutomationExecutionKey,
  classifyAutomationExecution,
} from "../domain/automation-execution.mjs";

type ShopifyAdmin = NonNullable<
  Awaited<ReturnType<typeof authenticate.webhook>>["admin"]
>;

type ShopifyOrderLineItem = {
  product_id?: string | number | null;
  quantity: number;
  price: string;
  total_discount?: string | null;
};

export type ShopifyFulfilledOrder = {
  id?: string | number | null;
  name?: string | null;
  admin_graphql_api_id?: string | null;
  fulfillment_status?: string | null;
  customer?: {
    admin_graphql_api_id?: string | null;
  } | null;
  currency?: string | null;
  payment_gateway_names?: string[] | null;
  financial_status?: string | null;
  current_subtotal_price?: string | null;
  subtotal_price?: string | null;
  tags?: string;
  discount_codes?: Array<string | { code?: string }>;
  shipping_address?: {
    country_code?: string;
    country_code_v2?: string;
  } | null;
  line_items?: ShopifyOrderLineItem[];
};

type CustomerConditionData = {
  id: string;
  tags: string[];
  numberOfOrders: number | string;
};

type GraphqlError = {
  message?: string;
};

type CustomerQueryResponse = {
  data?: {
    customer?: CustomerConditionData | null;
  };
  errors?: GraphqlError[];
};

type StoreCreditMutationResponse = {
  data?: {
    storeCreditAccountCredit?: {
      storeCreditAccountTransaction?: {
        id: string;
        account?: { id: string } | null;
      } | null;
      userErrors?: GraphqlError[];
    } | null;
  };
  errors?: GraphqlError[];
};

type ProcessingError = Error & {
  knownRejection?: boolean;
};

function createProcessingError(
  message: string,
  knownRejection: boolean,
): ProcessingError {
  const error = new Error(message) as ProcessingError;
  error.knownRejection = knownRejection;
  return error;
}

function isKnownRejection(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "knownRejection" in error &&
    error.knownRejection === true
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unknown store credit processing error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function issueNativeStoreCredit(
  admin: ShopifyAdmin,
  {
    customerGid,
    amount,
    currencyCode,
    expiresAt,
    notifyCustomer,
  }: {
    customerGid: string;
    amount: string;
    currencyCode: string;
    expiresAt?: string;
    notifyCustomer?: boolean;
  },
): Promise<{ id: string; accountId: string }> {
  // Passing the customer ID allows Shopify to create the currency-specific
  // Store Credit account when the customer does not already have one.
  const creditResponse = await admin.graphql(
    `#graphql
      mutation CreditFlowStoreCreditCredit(
        $customerId: ID!
        $creditInput: StoreCreditAccountCreditInput!
      ) {
        storeCreditAccountCredit(id: $customerId, creditInput: $creditInput) {
          storeCreditAccountTransaction {
            id
            account {
              id
            }
          }
          userErrors {
            message
          }
        }
      }
    `,
    {
      variables: {
        customerId: customerGid,
        creditInput: {
          creditAmount: { amount, currencyCode },
          ...(expiresAt ? { expiresAt } : {}),
          notify: notifyCustomer ?? false,
        },
      },
    },
  );

  const creditBody = (await creditResponse.json()) as StoreCreditMutationResponse;
  const payload = creditBody.data?.storeCreditAccountCredit;
  const graphqlErrors = creditBody.errors ?? [];
  const userErrors = payload?.userErrors ?? [];
  const transactionId = payload?.storeCreditAccountTransaction?.id;
  const accountId = payload?.storeCreditAccountTransaction?.account?.id;

  if (graphqlErrors.length > 0 || userErrors.length > 0 || !transactionId || !accountId) {
    const messages = [...graphqlErrors, ...userErrors]
      .map((item) => item.message)
      .filter((message): message is string => Boolean(message));

    throw createProcessingError(
      messages.join("; ") || "Shopify did not return a store credit transaction and account reference.",
      graphqlErrors.length === 0 && userErrors.length > 0,
    );
  }

  return { id: transactionId, accountId };
}

type PaymentStatus = "PREPAID" | "COD" | "UNKNOWN";

function resolvePaymentStatus(order: ShopifyFulfilledOrder): PaymentStatus {
  const gateways = (order.payment_gateway_names ?? []).map((name) =>
    String(name).toLowerCase(),
  );

  const looksLikeCod = gateways.some((name) =>
    /cash.?on.?delivery|\bcod\b/.test(name),
  );

  if (looksLikeCod) return "COD";
  if (order.financial_status === "paid") return "PREPAID";

  return "UNKNOWN";
}

function hasCustomerConditions(conditions: unknown): boolean {
  if (!isRecord(conditions) || !Array.isArray(conditions.rules)) {
    return false;
  }

  return conditions.rules.some(
    (condition: unknown) =>
      isRecord(condition) &&
      typeof condition.field === "string" &&
      condition.field.startsWith("CUSTOMER_"),
  );
}

async function loadCustomerConditionData(
  admin: ShopifyAdmin,
  customerGid: string,
): Promise<CustomerConditionData | null> {
  try {
    const response = await admin.graphql(
      `#graphql
        query CreditFlowCustomerConditions($id: ID!) {
          customer(id: $id) {
            id
            tags
            numberOfOrders
          }
        }
      `,
      { variables: { id: customerGid } },
    );

    const body = (await response.json()) as CustomerQueryResponse;

    if (body.errors?.length) {
      console.error(
        "[CreditFlow] Customer condition query returned GraphQL errors:",
        body.errors,
      );
      return null;
    }

    const customer = body.data?.customer;

    if (
      !customer ||
      !Array.isArray(customer.tags) ||
      (typeof customer.numberOfOrders !== "number" &&
        typeof customer.numberOfOrders !== "string")
    ) {
      return null;
    }

    return customer;
  } catch (error) {
    console.error(
      "[CreditFlow] Unable to load customer condition data:",
      error,
    );

    // Fail closed for customer conditions.
    return null;
  }
}

/**
 * Handles one fully fulfilled order.
 *
 * Rules are evaluated in ascending priority order.
 * The first matching rule awards credit; rules do not stack.
 * Shopify remains the authoritative source of wallet balances.
 */
export async function processFulfilledOrder({
  db,
  admin,
  shop,
  order,
}: {
  db: PrismaClient;
  admin: ShopifyAdmin;
  shop: string;
  order: ShopifyFulfilledOrder;
}) {
  if (order.fulfillment_status !== "fulfilled") {
    return {
      status: "SKIPPED",
      reason: "ORDER_NOT_FULLY_FULFILLED",
    } as const;
  }

  const customerGid = order.customer?.admin_graphql_api_id;
  const orderGid = order.admin_graphql_api_id;

  if (!customerGid || !orderGid) {
    return {
      status: "SKIPPED",
      reason: "ORDER_HAS_NO_CUSTOMER_OR_GID",
    } as const;
  }

  const currencyCode = String(order.currency ?? "").toUpperCase();

  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    return {
      status: "SKIPPED",
      reason: "INVALID_ORDER_CURRENCY",
    } as const;
  }

  const rules = await db.automationRule.findMany({
    where: {
      shop,
      enabled: true,
      archivedAt: null,
      trigger: "ORDER_FULFILLED",
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  if (rules.length === 0) {
    const executionKey = buildAutomationExecutionKey(shop, orderGid, null);
    const now = new Date();
    await db.automationExecution.upsert({
      where: { executionKey },
      create: {
        shop,
        executionKey,
        orderGid,
        orderName: order.name ?? null,
        ruleNameSnapshot: "No active automation",
        trigger: "ORDER_FULFILLED",
        status: "SKIPPED",
        reason: "NO_ACTIVE_REWARD_RULES",
        currencyCode,
        completedAt: now,
      },
      update: {
        status: "SKIPPED",
        reason: "NO_ACTIVE_REWARD_RULES",
        evaluatedAt: now,
        completedAt: now,
        attemptCount: { increment: 1 },
      },
    });
    return { status: "SKIPPED", reason: "NO_ACTIVE_REWARD_RULES" } as const;
  }

  const orderSubtotal = String(
    order.current_subtotal_price ?? order.subtotal_price ?? "0",
  );
  const paymentStatus = resolvePaymentStatus(order);

  const needsCustomerData = rules.some((rule) =>
    hasCustomerConditions(rule.conditions),
  );

  const customer = needsCustomerData
    ? await loadCustomerConditionData(admin, customerGid)
    : null;

  const lineItems = (order.line_items ?? []).map((line) => ({
    product_id: line.product_id ?? undefined,
    quantity: Number(line.quantity),
    price: String(line.price),
    total_discount: String(line.total_discount ?? "0"),
  }));

  for (const rule of rules) {
    if (
      rule.rewardType !== "PERCENTAGE" &&
      rule.rewardType !== "FIXED"
    ) {
      throw new Error(`Automation rule ${rule.id} has an invalid reward type.`);
    }

    if (
      rule.rewardBase !== "ORDER_SUBTOTAL" &&
      rule.rewardBase !== "ELIGIBLE_ITEMS"
    ) {
      throw new Error(`Automation rule ${rule.id} has an invalid reward base.`);
    }

    if (
      rule.productMode !== "ALL" &&
      rule.productMode !== "INCLUDE" &&
      rule.productMode !== "EXCLUDE"
    ) {
      throw new Error(`Automation rule ${rule.id} has an invalid product mode.`);
    }

    let productIds: string[];

    try {
      const parsed: unknown = JSON.parse(rule.productIds || "[]");
      productIds = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      throw new Error(`Automation rule ${rule.id} has invalid productIds JSON.`);
    }

    const executionKey = buildAutomationExecutionKey(shop, orderGid, rule.id);
    const evaluatedAt = new Date();

    await db.automationExecution.upsert({
      where: { executionKey },
      create: {
        shop,
        executionKey,
        orderGid,
        orderName: order.name ?? null,
        ruleId: rule.id,
        ruleNameSnapshot: rule.name,
        rulePrioritySnapshot: rule.priority,
        trigger: rule.trigger,
        status: "PROCESSING",
        reason: "EVALUATING",
        orderSubtotal,
        currencyCode,
        evaluatedAt,
      },
      update: {
        orderName: order.name ?? null,
        ruleNameSnapshot: rule.name,
        rulePrioritySnapshot: rule.priority,
        trigger: rule.trigger,
        status: "PROCESSING",
        reason: "EVALUATING",
        orderSubtotal,
        currencyCode,
        conditions: Prisma.DbNull,
        eligibleSubtotal: null,
        rewardBase: null,
        rewardBaseAmount: null,
        estimatedReward: null,
        creditGrantId: null,
        grantAmount: null,
        errorMessage: null,
        evaluatedAt,
        completedAt: null,
        attemptCount: { increment: 1 },
      },
    });

    const conditionEvaluation = evaluateRuleConditions({
      order,
      conditions: rule.conditions,
      orderSubtotal,
      currencyCode,
      paymentStatus,
      customer,
    });
    const conditionSnapshot = conditionEvaluation as unknown as Prisma.InputJsonValue;

    const eligibleSubtotal = conditionEvaluation.matches
      ? calculateEligibleLineSubtotal(
          lineItems,
          { productMode: rule.productMode, productIds },
          currencyCode,
        )
      : null;

    const calculation = conditionEvaluation.matches
      ? calculateReward({
          orderSubtotal,
          eligibleSubtotal: eligibleSubtotal!,
          currencyCode,
          paymentStatus,
          rule: {
            enabled: rule.enabled,
            requirePrepaid: rule.requirePrepaid,
            minimumOrderValue:
              rule.minimumOrderValue == null
                ? null
                : String(rule.minimumOrderValue),
            rewardBase: rule.rewardBase,
            rewardType: rule.rewardType,
            fixedAmount:
              rule.fixedAmount == null ? undefined : String(rule.fixedAmount),
            percentage:
              rule.percentage == null ? undefined : String(rule.percentage),
            maximumReward:
              rule.maximumReward == null ? null : String(rule.maximumReward),
            productMode: rule.productMode,
            productIds,
          },
        })
      : null;

    const executionOutcome = classifyAutomationExecution({
      conditionEvaluation,
      calculation,
    });
    const rewardBaseAmount = rule.rewardBase === "ELIGIBLE_ITEMS"
      ? eligibleSubtotal
      : orderSubtotal;

    if (executionOutcome.status !== "PROCESSING") {
      await db.automationExecution.update({
        where: { executionKey },
        data: {
          status: executionOutcome.status,
          reason: executionOutcome.reason,
          conditions: conditionSnapshot,
          eligibleSubtotal,
          rewardBase: rule.rewardBase,
          rewardBaseAmount,
          estimatedReward: "0",
          completedAt: new Date(),
        },
      });
      continue;
    }

    if (!calculation || !calculation.eligible || eligibleSubtotal == null) {
      continue;
    }

    await db.automationExecution.update({
      where: { executionKey },
      data: {
        status: "PROCESSING",
        reason: "REWARD_ELIGIBLE",
        conditions: conditionSnapshot,
        eligibleSubtotal,
        rewardBase: rule.rewardBase,
        rewardBaseAmount,
        estimatedReward: calculation.amount,
        completedAt: null,
      },
    });

    if (
      rule.expiryDays != null &&
      (!Number.isInteger(rule.expiryDays) || rule.expiryDays < 1 || rule.expiryDays > 3650)
    ) {
      throw new Error(`Automation rule ${rule.id} has invalid expiryDays.`);
    }

    const emailSettings = await db.emailNotificationSettings.findUnique({
      where: { shop },
      select: { issuedEmailMode: true },
    });
    const issuedEmailMode = emailSettings?.issuedEmailMode ?? "SHOPIFY_NATIVE";
    const expiresAt = rule.expiryDays
      ? new Date(Date.now() + rule.expiryDays * 86400000).toISOString()
      : undefined;
    const expiresAtDate = expiresAt ? new Date(expiresAt) : null;

    const eventKey = `fulfilled:${shop}:${orderGid}:${rule.id}`;
    let grant: CreditGrant;

    try {
      grant = await db.creditGrant.create({
        data: {
          shop,
          eventKey,
          customerGid,
          orderGid,
          ruleId: rule.id,
          ruleNameSnapshot: rule.name,
          ruleSnapshot: createAutomationRuleSnapshot(rule) as Prisma.InputJsonValue,
          amount: calculation.amount,
          currencyCode,
          rewardBaseAmount:
            rule.rewardBase === "ELIGIBLE_ITEMS"
              ? eligibleSubtotal
              : orderSubtotal,
          expiresAt: expiresAtDate,
          status: "PROCESSING",
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existingGrant = await db.creditGrant.findUnique({
          where: { eventKey },
          select: { id: true, status: true, amount: true },
        });

        if (existingGrant?.status === "ISSUED") {
          await db.automationExecution.update({
            where: { executionKey },
            data: {
              status: "ISSUED",
              reason: "REWARD_ALREADY_ISSUED",
              creditGrantId: existingGrant.id,
              grantAmount: existingGrant.amount.toString(),
              completedAt: new Date(),
            },
          });
          return {
            status: "SKIPPED",
            reason: "REWARD_ALREADY_ISSUED",
            ruleId: rule.id,
          } as const;
        }

        if (existingGrant?.status === "PROCESSING") {
          await db.automationExecution.update({
            where: { executionKey },
            data: {
              status: "REVIEW_REQUIRED",
              reason: "REWARD_ALREADY_PROCESSING",
              creditGrantId: existingGrant.id,
              errorMessage: "A prior grant reservation is still processing.",
              completedAt: new Date(),
            },
          });
          return {
            status: "SKIPPED",
            reason: "REWARD_ALREADY_PROCESSING",
            ruleId: rule.id,
          } as const;
        }

        await db.automationExecution.update({
          where: { executionKey },
          data: {
            status: "REVIEW_REQUIRED",
            reason: "EXISTING_GRANT_REQUIRES_RECONCILIATION",
            creditGrantId: existingGrant?.id ?? null,
            errorMessage: "An existing grant requires financial reconciliation.",
            completedAt: new Date(),
          },
        });
        return {
          status: "REVIEW_REQUIRED",
          reason: "EXISTING_GRANT_REQUIRES_RECONCILIATION",
          ruleId: rule.id,
          grantId: existingGrant?.id ?? null,
        } as const;
      }

      await db.automationExecution.update({
        where: { executionKey },
        data: {
          status: "RETRY_PENDING",
          reason: "GRANT_RESERVATION_FAILED",
          errorMessage: errorMessage(error).slice(0, 1000),
        },
      });
      throw error;
    }

    let shopifyTransactionGid: string | null = null;

    let shopifyAccountGid: string | null = null;

    try {
      const transaction = await issueNativeStoreCredit(admin, {
        customerGid,
        amount: calculation.amount,
        currencyCode,
        expiresAt,
        notifyCustomer:
          rule.notifyCustomer && issuedEmailMode === "SHOPIFY_NATIVE",
      });

      // Retain external transaction references in case the following DB transaction fails.
      shopifyTransactionGid = transaction.id;
      shopifyAccountGid = transaction.accountId;

      await db.$transaction(async (tx) => {
        await tx.creditGrant.update({
          where: { id: grant.id },
          data: {
            status: "ISSUED",
            shopifyTransactionGid: transaction.id,
            shopifyAccountGid: transaction.accountId,
            expiresAt: expiresAtDate,
            issuedAt: new Date(),
          },
        });

        await tx.creditLedgerEntry.create({
          data: {
            shop,
            eventKey,
            customerGid,
            orderGid,
            creditGrantId: grant.id,
            transactionType: "CASHBACK_CREDIT",
            amount: calculation.amount,
            currencyCode,
            reason: `Cashback for order ${order.name || order.id || orderGid}`,
            shopifyTransactionGid: transaction.id,
            expiresAt: expiresAtDate,
          },
        });

        if (rule.notifyCustomer && issuedEmailMode === "CREDITFLOW_CUSTOM") {
          await tx.notification.create({
            data: {
              shop,
              customerGid,
              dedupeKey: `credit-issued:${shop}:${grant.id}`,
              type: "CREDIT_ISSUED",
              status: "QUEUED",
              templateKey: "CREDIT_ISSUED",
              metadata: {
                creditGrantId: grant.id,
                amount: calculation.amount,
                currencyCode,
                issuedEmailMode,
                expiresAt: expiresAtDate?.toISOString() ?? null,
                shopifyAccountGid: transaction.accountId,
                shopifyTransactionGid: transaction.id,
                orderName: order.name || order.id || orderGid,
              },
              scheduledAt: new Date(),
            },
          });
        }

        await tx.automationExecution.update({
          where: { executionKey },
          data: {
            status: "ISSUED",
            reason: "REWARD_ISSUED",
            creditGrantId: grant.id,
            grantAmount: calculation.amount,
            completedAt: new Date(),
            errorMessage: null,
          },
        });
      });

      return {
        status: "ISSUED",
        amount: calculation.amount,
        currencyCode,
        transactionId: transaction.id,
        ruleId: rule.id,
      } as const;
    } catch (error) {
      try {
        await db.creditGrant.update({
          where: { id: grant.id },
          data: {
            status: isKnownRejection(error) ? "FAILED" : "REVIEW_REQUIRED",
            ...(shopifyTransactionGid
              ? { shopifyTransactionGid }
              : {}),
            ...(shopifyAccountGid
              ? { shopifyAccountGid }
              : {}),
            expiresAt: expiresAtDate,
            errorMessage: errorMessage(error),
          },
        });
      } catch (statusUpdateError) {
        console.error(
          `[CreditFlow] Could not persist failure status for grant ${grant.id}:`,
          statusUpdateError,
        );
      }

      try {
        await db.automationExecution.update({
          where: { executionKey },
          data: {
            status: isKnownRejection(error) ? "FAILED" : "REVIEW_REQUIRED",
            reason: isKnownRejection(error) ? "SHOPIFY_REJECTED" : "SHOPIFY_OUTCOME_UNCERTAIN",
            creditGrantId: grant.id,
            grantAmount: calculation.amount,
            errorMessage: errorMessage(error).slice(0, 1000),
            completedAt: new Date(),
          },
        });
      } catch (executionUpdateError) {
        console.error(
          `[CreditFlow] Could not persist execution history for grant ${grant.id}:`,
          executionUpdateError,
        );
      }

      // An uncertain Shopify mutation must be reconciled, not blindly retried.
      throw error;
    }
  }

  return {
    status: "SKIPPED",
    reason: "NO_MATCHING_REWARD_RULE",
  } as const;
}
