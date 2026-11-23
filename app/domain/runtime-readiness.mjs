const REQUIRED_SHOPIFY_SCOPES = [
  "read_orders",
  "read_customers",
  "read_products",
  "write_store_credit_account_transactions",
];

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidAppUrl(value, isProduction) {
  if (!hasValue(value)) return false;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  const isPlaceholder =
    parsed.hostname === "example.com" ||
    parsed.hostname.endsWith(".example.com");

  if (isPlaceholder) return false;
  if (isProduction) return parsed.protocol === "https:";

  return (
    parsed.protocol === "https:" ||
    (parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(parsed.hostname))
  );
}

/**
 * Validate only non-secret configuration state. Never return environment
 * values: this result is safe to use in a public readiness response.
 */
export function inspectRuntimeConfiguration(env = process.env) {
  const issues = [];
  const isProduction = env.NODE_ENV === "production";

  for (const key of [
    "DATABASE_URL",
    "SHOPIFY_API_KEY",
    "SHOPIFY_API_SECRET",
    "SCOPES",
    "SHOPIFY_APP_URL",
  ]) {
    if (!hasValue(env[key])) issues.push(`MISSING_${key}`);
  }

  if (!isValidAppUrl(env.SHOPIFY_APP_URL, isProduction)) {
    issues.push("INVALID_SHOPIFY_APP_URL");
  }

  const configuredScopes = new Set(
    String(env.SCOPES ?? "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
  );

  for (const scope of REQUIRED_SHOPIFY_SCOPES) {
    if (!configuredScopes.has(scope)) {
      issues.push(`MISSING_SCOPE_${scope}`);
    }
  }

  if (!hasValue(env.CREDITFLOW_WORKER_SECRET) ||
      env.CREDITFLOW_WORKER_SECRET.trim().length < 32) {
    issues.push("INVALID_CREDITFLOW_WORKER_SECRET");
  }

  return {
    ready: issues.length === 0,
    issues,
  };
}

export { REQUIRED_SHOPIFY_SCOPES };
