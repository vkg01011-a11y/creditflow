
import {
  calculateEligibleLineSubtotal,
  calculateReward,
  matchesRuleConditions,
} from "../domain/reward-engine.mjs";

async function issueNativeStoreCredit(
  admin: any,
  {
    customerGid,
    amount,
    currencyCode,
    expiresAt,
  }: {
    customerGid: string;
    amount: string;
    currencyCode: string;
    expiresAt?: string;
    notifyCustomer?: boolean;
  },
): Promise<{ id: string }> {
  const accountResponse = await admin.graphql(
    `#graphql
      query CreditFlowStoreCreditAccount($customerId: ID!) {
        customer(id: $customerId) {
          storeCreditAccounts(first: 50) {
            nodes {
              id
              balance {
                currencyCode
              }
            }
          }
        }
      }
    `,
    { variables: { customerId: customerGid } },
  );
  const accountBody = await accountResponse.json();
  const account = accountBody.data?.customer?.storeCreditAccounts?.nodes?.find(
    (node: any) => node.balance?.currencyCode === currencyCode,
  );

  if (accountBody.errors?.length || !account) {
    const error: any = new Error(
      accountBody.errors?.map((item: any) => item.message).join("; ") ||
        `No store credit account found for ${currencyCode}`,
    );
    error.knownRejection = !accountBody.errors?.length;
    throw error;
  }

  const creditResponse = await admin.graphql(
    `#graphql
      mutation CreditFlowStoreCreditCredit(
        $accountId: ID!
        $creditInput: StoreCreditAccountCreditInput!
      ) {
        storeCreditAccountCredit(id: $accountId, creditInput: $creditInput) {
          storeCreditAccountTransaction {
            id
          }
          userErrors {
            message
          }
        }
      }
    `,
    {
      variables: {
        accountId: account.id,
        creditInput: {
          amount: { amount, currencyCode },
          ...(expiresAt ? { expiresAt } : {}),
        },
      },
    },
  );
  const creditBody = await creditResponse.json();
  const payload = creditBody.data?.storeCreditAccountCredit;
  const userErrors = payload?.userErrors || [];

  if (creditBody.errors?.length || userErrors.length || !payload?.storeCreditAccountTransaction?.id) {
    const error: any = new Error(
      [...(creditBody.errors || []), ...userErrors]
        .map((item: any) => item.message)
        .join("; ") || "Store credit transaction was not returned",
    );
    error.knownRejection = userErrors.length > 0;
    throw error;
  }

  return { id: payload.storeCreditAccountTransaction.id };
}

type PaymentStatus = "PREPAID" | "COD" | "UNKNOWN";

function resolvePaymentStatus(order: any): PaymentStatus {
  const gateways = (order.payment_gateway_names || []).map(
    (name: string) => String(name).toLowerCase(),
  );

  const looksLikeCod = gateways.some((name: string) =>
    /cash.?on.?delivery|\bcod\b/.test(name),
  );

  if (looksLikeCod) return "COD";

  if (order.financial_status === "paid") return "PREPAID";

  return "UNKNOWN";
}

function hasCustomerConditions(conditions: unknown): boolean {
  if (
    typeof conditions !== "object" ||
    conditions === null ||
    Array.isArray(conditions)
  ) {
    return false;
  }

  const rules = (conditions as { rules?: unknown }).rules;

  if (!Array.isArray(rules)) return false;

  return rules.some(
    (condition) =>
      typeof condition === "object" &&
      condition !== null &&
      typeof (condition as { field?: unknown }).field === "string" &&
      (condition as { field: string }).field.startsWith("CUSTOMER_"),
  );
}

async function loadCustomerConditionData(
  admin: any,
  customerGid: string,
) {
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
      {
        variables: {
          id: customerGid,
        },
      },
    );

    const body = await response.json();

    if (body.errors?.length) {
      console.error(
        "[CreditFlow] Customer condition query returned GraphQL errors:",
        body.errors,
      );
      return null;
    }

    return body.data?.customer ?? null;
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
 *
 * Shopify remains the authoritative source of wallet balances.
 */
export async function processFulfilledOrder({
  db,
  admin,
  shop,
  order,
}: {
  db: any;
  admin: any;
  shop: string;
  order: any;
}) {
  if (order.fulfillment_status !== "fulfilled") {
    return {
      status: "SKIPPED",
      reason: "ORDER_NOT_FULLY_FULFILLED",
    };
  }

  const customerGid = order.customer?.admin_graphql_api_id;
  const orderGid = order.admin_graphql_api_id;

  if (!customerGid || !orderGid) {
    return {
      status: "SKIPPED",
      reason: "ORDER_HAS_NO_CUSTOMER_OR_GID",
    };
  }

  const currencyCode = String(order.currency || "").toUpperCase();

  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    return {
      status: "SKIPPED",
      reason: "INVALID_ORDER_CURRENCY",
    };
  }

  const rules = await db.automationRule.findMany({
    where: {
      shop,
      enabled: true,
      archivedAt: null,
      trigger: "ORDER_FULFILLED",
    },
    orderBy: [
      { priority: "asc" },
      { createdAt: "asc" },
    ],
  });

  if (rules.length === 0) {
    return {
      status: "SKIPPED",
      reason: "NO_ACTIVE_REWARD_RULES",
    };
  }

  const orderSubtotal = String(
    order.current_subtotal_price ??
    order.subtotal_price ??
    "0",
  );

  const paymentStatus = resolvePaymentStatus(order);

  const needsCustomerData = rules.some((rule: any) =>
    hasCustomerConditions(rule.conditions),
  );

  const customer = needsCustomerData
    ? await loadCustomerConditionData(admin, customerGid)
    : null;

  for (const rule of rules) {
    let productIds: string[] = [];

    try {
      const parsed = JSON.parse(String(rule.productIds || "[]"));

      productIds = Array.isArray(parsed)
        ? parsed.map(String)
        : [];
    } catch {
      throw new Error(
        `Automation rule ${rule.id} has invalid productIds JSON`,
      );
    }

    const conditionsMatch = matchesRuleConditions({
      order,
      conditions: rule.conditions,
      orderSubtotal,
      currencyCode,
      paymentStatus,
      customer,
    });

    if (!conditionsMatch) continue;

    const eligibleSubtotal = calculateEligibleLineSubtotal(
      order.line_items || [],
      {
        productMode: rule.productMode,
        productIds,
      },
      currencyCode,
    );

    const calculation = calculateReward({
      orderSubtotal,
      eligibleSubtotal,
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
          rule.fixedAmount == null
            ? undefined
            : String(rule.fixedAmount),

        percentage:
          rule.percentage == null
            ? undefined
            : String(rule.percentage),

        maximumReward:
          rule.maximumReward == null
            ? null
            : String(rule.maximumReward),

        productMode: rule.productMode,
        productIds,
      },
    });

    if (!calculation.eligible) continue;

    const eventKey = `fulfilled:${shop}:${orderGid}:${rule.id}`;

    let grant;

    try {
      grant = await db.creditGrant.create({
        data: {
          shop,
          eventKey,
          customerGid,
          orderGid,
          ruleId: rule.id,
          amount: calculation.amount,
          currencyCode,
          status: "PROCESSING",
        },
      });
    } catch (error: any) {
      if (error?.code === "P2002") {
        return {
          status: "SKIPPED",
          reason: "REWARD_ALREADY_RESERVED",
          ruleId: rule.id,
        };
      }

      throw error;
    }

    try {
      const expiresAt = rule.expiryDays
        ? new Date(
            Date.now() + Number(rule.expiryDays) * 86400000,
          ).toISOString()
        : undefined;

      const transaction = await issueNativeStoreCredit(admin, {
        customerGid,
        amount: calculation.amount,
        currencyCode,
        expiresAt,
        notifyCustomer: rule.notifyCustomer,
      });

      await db.$transaction([
        db.creditGrant.update({
          where: { id: grant.id },
          data: {
            status: "ISSUED",
            shopifyTransactionGid: transaction.id,
            issuedAt: new Date(),
          },
        }),

        db.creditLedgerEntry.create({
          data: {
            shop,
            eventKey,
            customerGid,
            orderGid,
            creditGrantId: grant.id,
            transactionType: "CASHBACK_CREDIT",
            amount: calculation.amount,
            currencyCode,
            reason: `Cashback for order ${order.name || order.id}`,
            shopifyTransactionGid: transaction.id,
            expiresAt: expiresAt ? new Date(expiresAt) : null,
          },
        }),
      ]);

      return {
        status: "ISSUED",
        amount: calculation.amount,
        currencyCode,
        transactionId: transaction.id,
        ruleId: rule.id,
      };
    } catch (error: any) {
      const knownRejection = Boolean(error?.knownRejection);

      await db.creditGrant.update({
        where: { id: grant.id },
        data: {
          status: knownRejection ? "FAILED" : "REVIEW_REQUIRED",
          errorMessage: String(
            error?.message || "Unknown store credit issue",
          ),
        },
      });

      // An uncertain Shopify mutation must be reconciled, not blindly retried.
      throw error;
    }
  }

  return {
    status: "SKIPPED",
    reason: "NO_MATCHING_REWARD_RULE",
  };
}
