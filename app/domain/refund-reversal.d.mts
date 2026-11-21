
export function sumMoneyAmounts(values: string[], currencyCode: string): string;

export function calculateProportionalReversal(input: {
  grantAmount: string;
  rewardBaseAmount: string;
  previouslyRefundedBaseAmount?: string;
  refundBaseAmount: string;
  previouslyReversedAmount?: string;
  currencyCode: string;
}): {
  amount: string;
  cumulativeRefundedBaseAmount: string;
  targetReversedAmount: string;
};
