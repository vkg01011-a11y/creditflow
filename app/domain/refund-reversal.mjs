
import { fromMinorUnits, toMinorUnits } from "./money.mjs";

export function sumMoneyAmounts(values, currencyCode) {
  const total = values.reduce(
    (sum, value) => sum + toMinorUnits(String(value), currencyCode),
    0n,
  );
  return fromMinorUnits(total, currencyCode);
}

/**
 * Calculates the incremental cashback debit after this refund.
 * Values use exact currency minor units and cumulative totals are capped.
 */
export function calculateProportionalReversal({
  grantAmount,
  rewardBaseAmount,
  previouslyRefundedBaseAmount = "0",
  refundBaseAmount,
  previouslyReversedAmount = "0",
  currencyCode,
}) {
  const grantMinor = toMinorUnits(String(grantAmount), currencyCode);
  const originalBaseMinor = toMinorUnits(String(rewardBaseAmount), currencyCode);
  const previousRefundedMinor = toMinorUnits(
    String(previouslyRefundedBaseAmount),
    currencyCode,
  );
  const refundMinor = toMinorUnits(String(refundBaseAmount), currencyCode);
  const previousReversedMinor = toMinorUnits(
    String(previouslyReversedAmount),
    currencyCode,
  );

  if (grantMinor <= 0n) throw new RangeError("Grant amount must be greater than zero.");
  if (originalBaseMinor <= 0n) throw new RangeError("Original reward basis must be greater than zero.");
  if (previousReversedMinor > grantMinor) {
    throw new RangeError("Previously reversed amount exceeds the grant.");
  }

  const requestedCumulative = previousRefundedMinor + refundMinor;
  const cumulativeRefundedMinor =
    requestedCumulative > originalBaseMinor ? originalBaseMinor : requestedCumulative;

  const targetReversedMinor =
    (grantMinor * cumulativeRefundedMinor) / originalBaseMinor;

  if (targetReversedMinor < previousReversedMinor) {
    throw new RangeError("Cumulative reversal would reduce the prior reversal.");
  }

  const incrementalMinor = targetReversedMinor - previousReversedMinor;

  return {
    amount: fromMinorUnits(incrementalMinor, currencyCode),
    cumulativeRefundedBaseAmount: fromMinorUnits(cumulativeRefundedMinor, currencyCode),
    targetReversedAmount: fromMinorUnits(targetReversedMinor, currencyCode),
    fullyReversed: targetReversedMinor >= grantMinor,
  };
}
