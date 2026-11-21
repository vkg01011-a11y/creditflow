import test from "node:test";
import assert from "node:assert/strict";
import { decimalPattern } from "../app/domain/decimal-validation.mjs";

test("integer-only validation accepts integers and rejects fractions", () => {
  const pattern = decimalPattern(0);

  assert.equal(pattern.test("0"), true);
  assert.equal(pattern.test("25"), true);
  assert.equal(pattern.test("25.0"), false);
  assert.equal(pattern.test("25.01"), false);
});

test("decimal validation respects the configured precision", () => {
  const pattern = decimalPattern(2);

  assert.equal(pattern.test("25"), true);
  assert.equal(pattern.test("25.5"), true);
  assert.equal(pattern.test("25.50"), true);
  assert.equal(pattern.test("25.501"), false);
});

test("decimal validation rejects malformed and negative values", () => {
  const pattern = decimalPattern(6);

  assert.equal(pattern.test("-1"), false);
  assert.equal(pattern.test("1."), false);
  assert.equal(pattern.test(".5"), false);
  assert.equal(pattern.test("abc"), false);
});

test("invalid precision configuration is rejected", () => {
  assert.throws(() => decimalPattern(-1), RangeError);
  assert.throws(() => decimalPattern(1.5), RangeError);
});
