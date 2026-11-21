
import type { PrismaClient } from "@prisma/client";
import type { authenticate } from "../shopify.server";
import {
  calculateProportionalReversal,
  sumMoneyAmounts,
} from "../domain/refund-reversal.mjs";

type ShopifyAdmin = NonNullable<
  Awaited<ReturnType<typeof authenticate.webhook>>["admin"]
>;

export type NormalizedRefundPayload = {
  refundGid: string;
  orderGid: string;
  lineItems: Array<{
    productId: string | null;
    subtotal: string;
    currencyCode: string | null;
  }>;
};

type ProcessRefundResult =
  | { status: "PROCESSED"; reason: string }
  | { status: "RETRY"; reason: string }
  | { status: "REVIEW_REQUIRED"; reason: string };

type DebitResponse = {
  data?: {
    storeCreditAccountDebit?: {
      storeCreditAccountTransaction?: { id: string } | null;
      userErrors?: Array<{ message?: string; field?: string[] }>;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

function parseProductIds(value: string): string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(value || "[]"); }
  catch { throw new Error("The reward rule has invalid product eligibility data."); }
  if (!Array.isArray(parsed)) throw new Error("The reward rule product eligibility data is invalid.");
  return parsed.map(String);
}

function selectRefundBase(refund: NormalizedRefundPayload, grant: {
  currencyCode: string;
  rule: { rewardBase: string; productMode: string; productIds: string };
}) {
  const currencyCode = grant.currencyCode.toUpperCase();
  const productMode = grant.rule.productMode;

  if (!["ORDER_SUBTOTAL", "ELIGIBLE_ITEMS"].includes(grant.rule.rewardBase)) {
    throw new Error("The reward rule has an unsupported reward base.");
  }
  if (!["ALL", "INCLUDE", "EXCLUDE"].includes(productMode)) {
    throw new Error("The reward rule has an unsupported product mode.");
  }

  const productIds = grant.rule.rewardBase === "ELIGIBLE_ITEMS" && productMode !== "ALL"
    ? parseProductIds(grant.rule.productIds)
    : [];

  if (grant.rule.rewardBase === "ELIGIBLE_ITEMS" && productMode !== "ALL" &&
      refund.lineItems.some((item) => item.productId == null)) {
    throw new Error("A refund line is missing its product ID, so eligible-item cashback cannot be calculated safely.");
  }

  const selected: string[] = [];
  for (const item of refund.lineItems) {
    if (item.currencyCode && item.currencyCode !== currencyCode) {
      throw new Error("Refund currency " + item.currencyCode + " does not match reward currency " + currencyCode + ".");
    }
    const included =
      grant.rule.rewardBase === "ORDER_SUBTOTAL" ||
      productMode === "ALL" ||
      (productMode === "INCLUDE" && productIds.includes(String(item.productId))) ||
      (productMode === "EXCLUDE" && !productIds.includes(String(item.productId)));
    if (included) selected.push(item.subtotal);
  }

  return sumMoneyAmounts(selected, currencyCode);
}

async function reserveReversal({ db, shop, refund, webhookId, grantId }: {
  db: PrismaClient; shop: string; refund: NormalizedRefundPayload;
  webhookId: string; grantId: string;
}) {
  return db.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      'SELECT "id" FROM "CreditGrant" WHERE "id" = $1 AND "shop" = $2 FOR UPDATE',
      grantId, shop,
    );

    const grant = await tx.creditGrant.findFirst({
      where: { id: grantId, shop, orderGid: refund.orderGid },
      include: { rule: true },
    });
    if (!grant) return { kind: "SKIP" as const };

    const writeReview = async (reason: string) => {
      await tx.creditReversal.create({
        data: {
          shop,
          refundGid: refund.refundGid,
          webhookId,
          orderGid: refund.orderGid,
          creditGrantId: grant.id,
          refundedBaseAmount: "0",
          amount: "0",
          currencyCode: grant.currencyCode,
          status: "REVIEW_REQUIRED",
          errorMessage: reason.slice(0, 2000),
        },
      });
      return { kind: "REVIEW" as const, reason };
    };

    const existing = await tx.creditReversal.findUnique({
      where: { shop_refundGid_creditGrantId: {
        shop, refundGid: refund.refundGid, creditGrantId: grant.id,
      } },
    });
    if (existing) {
      if (existing.status === "REVERSED" || existing.status === "NO_REVERSAL") {
        return { kind: "DONE" as const };
      }

      // A crashed worker can leave a reservation PROCESSING. After the same
      // 15-minute lease used by the queue, expose it as manual-review work.
      if (existing.status === "PROCESSING") {
        if (Date.now() - existing.updatedAt.getTime() < 15 * 60 * 1000) {
          return {
            kind: "WAIT" as const,
            reason: "This refund debit is currently being processed by another worker.",
          };
        }

        const reason =
          "The previous worker lease expired before the debit outcome was confirmed. Reconcile Shopify's store-credit transactions before retrying.";
        await tx.creditReversal.update({
          where: { id: existing.id },
          data: { status: "REVIEW_REQUIRED", errorMessage: reason },
        });
        return { kind: "REVIEW" as const, reason };
      }

      return { kind: "REVIEW" as const, reason: existing.errorMessage ||
        "A reversal for this refund already exists without a confirmed outcome." };
    }

    if (grant.status === "REVERSED") return { kind: "SKIP" as const };
    if (grant.status !== "ISSUED" && grant.status !== "PARTIALLY_REVERSED") {
      return writeReview("The cashback grant is in " + grant.status +
        " state and must be reconciled before it can be reversed.");
    }
    if (!grant.rewardBaseAmount || grant.rewardBaseAmount.lte(0)) {
      return writeReview(
        "The grant has no stored reward basis. This legacy grant needs manual reconciliation.",
      );
    }

    const unresolved = await tx.creditReversal.findFirst({
      where: { creditGrantId: grant.id, status: { in: ["PROCESSING", "REVIEW_REQUIRED"] } },
      orderBy: { createdAt: "asc" },
    });
    if (unresolved) {
      if (
        unresolved.status === "PROCESSING" &&
        Date.now() - unresolved.updatedAt.getTime() < 15 * 60 * 1000
      ) {
        return {
          kind: "WAIT" as const,
          reason: "Another refund debit for this cashback grant is currently in progress.",
        };
      }

      if (unresolved.status === "PROCESSING") {
        await tx.creditReversal.update({
          where: { id: unresolved.id },
          data: {
            status: "REVIEW_REQUIRED",
            errorMessage: "The previous worker lease expired before the debit outcome was confirmed. Reconcile Shopify's store-credit transactions.",
          },
        });
      }

      return writeReview(
        "A previous reversal has an uncertain outcome. Reconcile its Shopify transaction before another debit.",
      );
    }

    let refundBaseAmount: string;
    try { refundBaseAmount = selectRefundBase(refund, grant); }
    catch (error) {
      return writeReview(
        error instanceof Error ? error.message : "Refund basis could not be calculated.",
      );
    }

    const prior = await tx.creditReversal.findMany({
      where: { creditGrantId: grant.id, status: { in: ["REVERSED", "NO_REVERSAL"] } },
      orderBy: { createdAt: "asc" },
      select: { refundedBaseAmount: true, amount: true },
    });

    let previouslyRefundedBaseAmount: string;
    let priorReversedAmount: string;
    try {
      previouslyRefundedBaseAmount = sumMoneyAmounts(
        prior.map((item) => item.refundedBaseAmount.toString()), grant.currencyCode,
      );
      priorReversedAmount = sumMoneyAmounts(
        prior.map((item) => item.amount.toString()), grant.currencyCode,
      );
    } catch (error) {
      return writeReview(
        error instanceof Error ? error.message : "Prior reversals could not be reconciled.",
      );
    }

    const storedReversedAmount = grant.reversedAmount?.toString() ?? "0";
    if (sumMoneyAmounts([storedReversedAmount], grant.currencyCode) !== priorReversedAmount) {
      return writeReview("Grant reversal totals do not match the reversal ledger.");
    }

    let calculation: ReturnType<typeof calculateProportionalReversal>;
    try {
      calculation = calculateProportionalReversal({
        grantAmount: grant.amount.toString(),
        rewardBaseAmount: grant.rewardBaseAmount.toString(),
        previouslyRefundedBaseAmount,
        refundBaseAmount,
        previouslyReversedAmount: priorReversedAmount,
        currencyCode: grant.currencyCode,
      });
    } catch (error) {
      return writeReview(
        error instanceof Error ? error.message : "Proportional reversal could not be calculated.",
      );
    }

    const amountIsZero = /^0(?:\.0+)?$/.test(calculation.amount);
    const reversal = await tx.creditReversal.create({
      data: {
        shop, refundGid: refund.refundGid, webhookId,
        orderGid: refund.orderGid, creditGrantId: grant.id,
        refundedBaseAmount: refundBaseAmount,
        amount: calculation.amount,
        currencyCode: grant.currencyCode,
        status: amountIsZero ? "NO_REVERSAL" : "PROCESSING",
        ...(amountIsZero ? { processedAt: new Date() } : {}),
      },
    });

    return {
      kind: amountIsZero ? "DONE" as const : "RESERVED" as const,
      reversalId: reversal.id,
      amount: calculation.amount,
      nextReversedAmount: calculation.targetReversedAmount,
      fullyReversed: calculation.fullyReversed,
      currencyCode: grant.currencyCode,
      customerGid: grant.customerGid,
      grantId: grant.id,
    };
  });
}

export async function processRefund({ db, admin, shop, webhookId, refund }: {
  db: PrismaClient; admin: ShopifyAdmin; shop: string;
  webhookId: string; refund: NormalizedRefundPayload;
}): Promise<ProcessRefundResult> {
  const allGrants = await db.creditGrant.findMany({
    where: { shop, orderGid: refund.orderGid },
    select: { id: true, status: true },
    orderBy: { createdAt: "asc" },
  });

  if (allGrants.length === 0) {
    const processedFulfillment = await db.webhookEvent.findFirst({
      where: {
        shop, topic: "ORDERS_FULFILLED", status: "PROCESSED",
        payload: { path: ["admin_graphql_api_id"], equals: refund.orderGid },
      },
      select: { id: true },
    });
    if (processedFulfillment) {
      return { status: "PROCESSED", reason: "No cashback grant was issued for this order." };
    }
    return { status: "RETRY", reason:
      "Waiting for the order's fulfillment reward to finish before reconciling its refund." };
  }

  const unresolvedGrants = allGrants.filter((grant) =>
    grant.status === "PROCESSING" || grant.status === "REVIEW_REQUIRED"
  );
  if (unresolvedGrants.length > 0) {
    for (const grant of unresolvedGrants) {
      await reserveReversal({
        db, shop, refund, webhookId, grantId: grant.id,
      });
    }
    return { status: "REVIEW_REQUIRED", reason:
      "The order has a cashback grant with an uncertain outcome. Reconcile it before processing the refund." };
  }

  const grants = allGrants.filter((grant) =>
    grant.status === "ISSUED" || grant.status === "PARTIALLY_REVERSED"
  );

  for (const candidate of grants) {
    const reservation = await reserveReversal({
      db, shop, refund, webhookId, grantId: candidate.id,
    });
    if (reservation.kind === "WAIT") {
      return { status: "RETRY", reason: reservation.reason };
    }
    if (reservation.kind === "REVIEW") {
      return { status: "REVIEW_REQUIRED", reason: reservation.reason };
    }
    if (reservation.kind === "SKIP" || reservation.kind === "DONE") continue;

    // Commit the unique reservation before the external mutation; never blindly retry.
    try {
      const response = await admin.graphql(
        "mutation CreditFlowStoreCreditDebit($id: ID!, $debitInput: StoreCreditAccountDebitInput!) { " +
        "storeCreditAccountDebit(id: $id, debitInput: $debitInput) { " +
        "storeCreditAccountTransaction { id } userErrors { message field } } }",
        {
          variables: {
            id: reservation.customerGid,
            debitInput: { debitAmount: {
              amount: reservation.amount, currencyCode: reservation.currencyCode,
            } },
          },
        },
      );

      const body = (await response.json()) as DebitResponse;
      const payload = body.data?.storeCreditAccountDebit;
      const errors = [...(body.errors ?? []), ...(payload?.userErrors ?? [])];
      const transactionId = payload?.storeCreditAccountTransaction?.id;

      if (!response.ok || errors.length > 0 || !transactionId) {
        const message = errors.map((item) => item.message).filter(Boolean).join("; ") ||
          "Shopify debit returned HTTP " + response.status + " without a transaction ID.";
        await db.creditReversal.updateMany({
          where: { id: reservation.reversalId, status: "PROCESSING" },
          data: { status: "REVIEW_REQUIRED", errorMessage: message.slice(0, 2000) },
        });
        return { status: "REVIEW_REQUIRED", reason: message };
      }

      await db.$transaction([
        db.creditReversal.update({
          where: { id: reservation.reversalId },
          data: {
            status: "REVERSED", shopifyTransactionGid: transactionId,
            processedAt: new Date(), errorMessage: null,
          },
        }),
        db.creditGrant.update({
          where: { id: reservation.grantId },
          data: {
            reversedAmount: reservation.nextReversedAmount,
            status: reservation.fullyReversed ? "REVERSED" : "PARTIALLY_REVERSED",
          },
        }),
        db.creditLedgerEntry.create({
          data: {
            shop,
            eventKey: "refund:" + shop + ":" + refund.refundGid + ":" + reservation.grantId,
            customerGid: reservation.customerGid,
            orderGid: refund.orderGid,
            creditGrantId: reservation.grantId,
            transactionType: "REWARD_REVERSAL",
            direction: "DEBIT",
            amount: reservation.amount,
            currencyCode: reservation.currencyCode,
            reason: "Cashback reversal for refund " + refund.refundGid,
            shopifyTransactionGid: transactionId,
          },
        }),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Shopify debit or persistence error";
      try {
        await db.creditReversal.updateMany({
          where: { id: reservation.reversalId, status: "PROCESSING" },
          data: { status: "REVIEW_REQUIRED", errorMessage: message.slice(0, 2000) },
        });
      } catch (markError) {
        console.error("[CreditFlow] Unable to mark uncertain refund reversal:", markError);
      }
      return { status: "REVIEW_REQUIRED", reason:
        "The debit outcome is uncertain. Reconcile the Shopify store-credit transaction before taking any further action." };
    }
  }

  return { status: "PROCESSED", reason: "Refund has been reconciled against the cashback grants." };
}
