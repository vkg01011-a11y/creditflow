/**
 * Build a validator for non-negative decimal strings with at most the
 * requested number of fractional digits. maxDecimals=0 accepts integers only.
 */
export function decimalPattern(maxDecimals = 6) {
  if (
    !Number.isInteger(maxDecimals) ||
    maxDecimals < 0 ||
    maxDecimals > 14
  ) {
    throw new RangeError("maxDecimals must be an integer from 0 to 14.");
  }

  const fractionalPart =
    maxDecimals === 0 ? "" : `(?:\\.\\d{1,${maxDecimals}})?`;

  return new RegExp(`^\\d{1,14}${fractionalPart}$`);
}
