
import test from "node:test";
import assert from "node:assert/strict";

import { calculateProportionalReversal } from "../app/domain/refund-reversal.mjs";

test("reverses cashback proportionally for a partial refund", () => {
  assert.deepEqual(calculateProportionalReversal({
    grantAmount: "100.00",
    rewardBaseAmount: "1000.00",
    refundBaseAmount: "500.00",
    currencyCode: "USD",
  }), {
    amount: "50.00",
    cumulativeRefundedBaseAmount: "500.00",
    targetReversedAmount: "50.00",
  });
});

test("calculates the incremental debit across multiple partial refunds", () => {
  assert.deepEqual(calculateProportionalReversal({
    grantAmount: "100.00",
    rewardBaseAmount: "1000.00",
    previouslyRefundedBaseAmount: "250.00",
    refundBaseAmount: "250.00",
    previouslyReversedAmount: "25.00",
    currencyCode: "USD",
  }), {
    amount: "25.00",
    cumulativeRefundedBaseAmount: "500.00",
    targetReversedAmount: "50.00",
  });
});

test("caps cumulative reversals at the original reward grant", () => {
  assert.deepEqual(calculateProportionalReversal({
    grantAmount: "75.00",
    rewardBaseAmount: "500.00",
    previouslyRefundedBaseAmount: "400.00",
    refundBaseAmount: "300.00",
    previouslyReversedAmount: "60.00",
    currencyCode: "USD",
  }), {
    amount: "15.00",
    cumulativeRefundedBaseAmount: "500.00",
    targetReversedAmount: "75.00",
  });
});

test("supports zero-decimal JPY and three-decimal KWD", () => {
  assert.equal(calculateProportionalReversal({
    grantAmount: "100",
    rewardBaseAmount: "1000",
    refundBaseAmount: "250",
    currencyCode: "JPY",
  }).amount, "25");

  assert.equal(calculateProportionalReversal({
    grantAmount: "10.000",
    rewardBaseAmount: "100.000",
    refundBaseAmount: "12.500",
    currencyCode: "KWD",
  }).amount, "1.250");
});

test("rejects zero grant, zero basis and invalid currency precision", () => {
  assert.throws(() => calculateProportionalReversal({
    grantAmount: "0.00",
    rewardBaseAmount: "100.00",
    refundBaseAmount: "10.00",
    currencyCode: "USD",
  }), /greater than zero/);

  assert.throws(() => calculateProportionalReversal({
    grantAmount: "10.00",
    rewardBaseAmount: "0.00",
    refundBaseAmount: "10.00",
    currencyCode: "USD",
  }), /greater than zero/);

  assert.throws(() => calculateProportionalReversal({
    grantAmount: "10.00",
    rewardBaseAmount: "100.00",
    refundBaseAmount: "1.001",
    currencyCode: "USD",
  }), /fractional digits/);
});
