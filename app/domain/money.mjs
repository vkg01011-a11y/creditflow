
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG",
  "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF",
]);

const THREE_DECIMAL_CURRENCIES = new Set([
  "BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND",
]);

export function currencyFractionDigits(currencyCode) {
  const currency = String(currencyCode || "").toUpperCase();

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new TypeError(`Invalid ISO currency code: ${currencyCode}`);
  }

  if (ZERO_DECIMAL_CURRENCIES.has(currency)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(currency)) return 3;

  return 2;
}

/**
 * Convert a non-negative decimal money string to integer minor units.
 * Uses BigInt to avoid floating-point currency calculation errors.
 */
export function toMinorUnits(value, currencyCode) {
  const digits = currencyFractionDigits(currencyCode);
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);

  if (!match) {
    throw new TypeError(`Invalid non-negative money amount: ${value}`);
  }

  const whole = BigInt(match[1]);
  const fraction = match[2] || "";

  if (
    fraction.length > digits &&
    /[1-9]/.test(fraction.slice(digits))
  ) {
    throw new RangeError(
      `${currencyCode} supports ${digits} fractional digits; received ${value}`,
    );
  }

  const normalizedFraction = fraction
    .slice(0, digits)
    .padEnd(digits, "0");

  const scale = 10n ** BigInt(digits);

  const fractionalMinor = normalizedFraction
    ? BigInt(normalizedFraction)
    : 0n;

  return whole * scale + fractionalMinor;
}

/**
 * Convert integer minor units back to a decimal string.
 */
export function fromMinorUnits(minorUnits, currencyCode) {
  const digits = currencyFractionDigits(currencyCode);
  const value = BigInt(minorUnits);

  if (value < 0n) {
    throw new RangeError("Money amount cannot be negative");
  }

  if (digits === 0) return value.toString();

  const scale = 10n ** BigInt(digits);
  const whole = value / scale;

  const fraction = (value % scale)
    .toString()
    .padStart(digits, "0");

  return `${whole}.${fraction}`;
}

/**
 * Convert a percentage into basis points.
 * Example: 2.50% = 250 basis points.
 */
export function percentageToBasisPoints(value) {
  const text = String(value).trim();
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text);

  if (!match) {
    throw new TypeError(`Invalid percentage: ${value}`);
  }

  const whole = BigInt(match[1]);

  const fraction = BigInt(
    (match[2] || "").padEnd(2, "0") || "0",
  );

  const basisPoints = whole * 100n + fraction;

  if (basisPoints > 10000n) {
    throw new RangeError("Percentage cannot exceed 100%");
  }

  return basisPoints;
}
