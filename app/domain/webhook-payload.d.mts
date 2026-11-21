export type NormalizedFulfillmentOrder = {
  id: string | null;
  name: string | null;
  admin_graphql_api_id: string;
  fulfillment_status: string | null;
  customer: { admin_graphql_api_id: string } | null;
  customerGid: string | null;
  currency: string | null;
  payment_gateway_names: string[];
  financial_status: string | null;
  current_subtotal_price: string | null;
  subtotal_price: string | null;
  tags: string;
  discount_codes: string[];
  shipping_address: {
    country_code: string | null;
    country_code_v2: string | null;
  } | null;
  line_items: Array<{
    product_id: string | number | null;
    quantity: number;
    price: string;
    total_discount: string;
  }>;
};

export function normalizeFulfillmentOrder(
  payload: unknown,
): NormalizedFulfillmentOrder;

export function normalizeCustomerPrivacyPayload(
  topic: "CUSTOMERS_DATA_REQUEST" | "CUSTOMERS_REDACT" | "SHOP_REDACT",
  payload: unknown,
): Record<string, unknown>;
