import test from "node:test";
import assert from "node:assert/strict";

import {
  inspectRuntimeConfiguration,
  REQUIRED_SHOPIFY_SCOPES,
} from "../app/domain/runtime-readiness.mjs";

const validProductionEnv = () => ({
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:password@db.example.net:5432/creditflow",
  SHOPIFY_API_KEY: "shopify-api-key",
  SHOPIFY_API_SECRET: "shopify-api-secret",
  SHOPIFY_APP_URL: "https://creditflow.example.app",
  SCOPES: REQUIRED_SHOPIFY_SCOPES.join(","),
  CREDITFLOW_WORKER_SECRET: "a-secure-worker-secret-with-more-than-32-chars",
});

test("accepts a fully configured production environment", () => {
  const result = inspectRuntimeConfiguration(validProductionEnv());
  assert.deepEqual(result, { ready: true, issues: [] });
});

test("rejects missing configuration and short worker secrets", () => {
  const env = validProductionEnv();
  delete env.SHOPIFY_API_SECRET;
  env.CREDITFLOW_WORKER_SECRET = "too-short";

  const result = inspectRuntimeConfiguration(env);
  assert.equal(result.ready, false);
  assert.ok(result.issues.includes("MISSING_SHOPIFY_API_SECRET"));
  assert.ok(result.issues.includes("INVALID_CREDITFLOW_WORKER_SECRET"));
});

test("rejects placeholder and non-HTTPS production app URLs", () => {
  const placeholder = validProductionEnv();
  placeholder.SHOPIFY_APP_URL = "https://example.com";
  assert.ok(
    inspectRuntimeConfiguration(placeholder).issues.includes(
      "INVALID_SHOPIFY_APP_URL",
    ),
  );

  const insecure = validProductionEnv();
  insecure.SHOPIFY_APP_URL = "http://creditflow.example.app";
  assert.ok(
    inspectRuntimeConfiguration(insecure).issues.includes(
      "INVALID_SHOPIFY_APP_URL",
    ),
  );
});

test("requires the full set of Shopify scopes used by the app", () => {
  const env = validProductionEnv();
  env.SCOPES = "read_orders,read_customers";

  const result = inspectRuntimeConfiguration(env);
  assert.equal(result.ready, false);
  assert.ok(result.issues.includes("MISSING_SCOPE_read_products"));
  assert.ok(
    result.issues.includes(
      "MISSING_SCOPE_write_store_credit_account_transactions",
    ),
  );
});

test("allows the local HTTP app URL during development", () => {
  const env = {
    ...validProductionEnv(),
    NODE_ENV: "development",
    SHOPIFY_APP_URL: "http://localhost:3000",
  };

  assert.deepEqual(inspectRuntimeConfiguration(env), {
    ready: true,
    issues: [],
  });
});

test("readiness diagnostics never echo environment values", () => {
  const env = validProductionEnv();
  env.CREDITFLOW_WORKER_SECRET = "sensitive-worker-secret-value";
  env.DATABASE_URL = "postgresql://sensitive-user:sensitive-password@host/db";

  const result = inspectRuntimeConfiguration(env);
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes(env.CREDITFLOW_WORKER_SECRET), false);
  assert.equal(serialized.includes("sensitive-password"), false);
});
