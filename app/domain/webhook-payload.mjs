function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function resourceGid(value, resource) {
  const text = optionalText(value);
  if (!text) return null;
  if (text.startsWith("gid://shopify/" + resource + "/")) return text;
  if (/^\d+$/.test(text)) return "gid://shopify/" + resource + "/" + text;
  return null;
}

export function normalizeFulfillmentOrder(payload) {
  if (!isRecord(payload)) {
    throw new TypeError("Fulfillment webhook payload must be an object.");
  }

  const rawCustomer = isRecord(payload.customer) ? payload.customer : null;
  const customerGid = resourceGid(
    rawCustomer?.admin_graphql_api_id ?? rawCustomer?.id,
    "Customer",
  );
  const orderGid = resourceGid(
    payload.admin_graphql_api_id ?? payload.id,
    "Order",
  );

  if (!orderGid) {
    throw new TypeError("Fulfillment webhook is missing a valid order ID.");
  }

  const rawShipping = isRecord(payload.shipping_address)
    ? payload.shipping_address
    : null;

  const lineItems = Array.isArray(payload.line_items)
    ? payload.line_items.filter(isRecord).map((line) => ({
        product_id: line.product_id ?? null,
        quantity: Number(line.quantity ?? 0),
        price: String(line.price ?? "0"),
        total_discount: String(line.total_discount ?? "0"),
      }))
    : [];

  const discountCodes = Array.isArray(payload.discount_codes)
    ? payload.discount_codes
        .map((item) => {
          if (typeof item === "string") return item;
          if (isRecord(item)) return optionalText(item.code);
          return null;
        })
        .filter(Boolean)
    : [];

  return {
    id: optionalText(payload.id),
    name: optionalText(payload.name),
    admin_graphql_api_id: orderGid,
    fulfillment_status: optionalText(payload.fulfillment_status),
    customer: customerGid
      ? { admin_graphql_api_id: customerGid }
      : null,
    customerGid,
    currency: optionalText(payload.currency),
    payment_gateway_names: Array.isArray(payload.payment_gateway_names)
      ? payload.payment_gateway_names
          .map(optionalText)
          .filter(Boolean)
      : [],
    financial_status: optionalText(payload.financial_status),
    current_subtotal_price: optionalText(payload.current_subtotal_price),
    subtotal_price: optionalText(payload.subtotal_price),
    tags: typeof payload.tags === "string" ? payload.tags : "",
    discount_codes: discountCodes,
    shipping_address: rawShipping
      ? {
          country_code: optionalText(rawShipping.country_code),
          country_code_v2: optionalText(rawShipping.country_code_v2),
        }
      : null,
    line_items: lineItems,
  };
}

export function normalizeCustomerPrivacyPayload(topic, payload) {
  if (!isRecord(payload)) {
    throw new TypeError("Privacy webhook payload must be an object.");
  }

  if (topic === "CUSTOMERS_DATA_REQUEST" || topic === "CUSTOMERS_REDACT") {
    const rawCustomer = isRecord(payload.customer) ? payload.customer : null;
    const customerGid = resourceGid(rawCustomer?.id, "Customer");

    if (!customerGid) {
      throw new TypeError("Privacy webhook is missing a valid customer ID.");
    }

    const orderField =
      topic === "CUSTOMERS_DATA_REQUEST"
        ? payload.orders_requested
        : payload.orders_to_redact;

    const requestedOrderIds = Array.isArray(orderField)
      ? orderField
          .map((id) => resourceGid(id, "Order"))
          .filter(Boolean)
      : [];

    return {
      customerGid,
      requestedOrderIds,
    };
  }

  if (topic === "SHOP_REDACT") {
    return {
      shopId: optionalText(payload.shop_id),
    };
  }

  throw new TypeError("Unsupported privacy webhook topic.");
}

/**
 * Persist only refund/order identifiers and shop-currency line subtotals.
 * Unrelated customer and payment data is deliberately discarded.
 */
export function normalizeRefundPayload(payload) {
  if (!isRecord(payload)) {
    throw new TypeError("Refund webhook payload must be an object.");
  }

  const refundGid = resourceGid(
    payload.admin_graphql_api_id ?? payload.id,
    "Refund",
  );
  const orderGid = resourceGid(
    payload.order_id ??
      (isRecord(payload.order)
        ? payload.order.admin_graphql_api_id ?? payload.order.id
        : null),
    "Order",
  );

  if (!refundGid) {
    throw new TypeError("Refund webhook is missing a valid refund ID.");
  }
  if (!orderGid) {
    throw new TypeError("Refund webhook is missing a valid order ID.");
  }

  const rawLines = Array.isArray(payload.refund_line_items)
    ? payload.refund_line_items
    : [];

  const lineItems = rawLines.filter(isRecord).map((line) => {
    const rawLineItem = isRecord(line.line_item) ? line.line_item : null;
    const shopMoney = isRecord(line.subtotal_set) &&
      isRecord(line.subtotal_set.shop_money)
      ? line.subtotal_set.shop_money
      : null;

    const subtotal = optionalText(shopMoney?.amount ?? line.subtotal);
    if (!subtotal || !/^\d+(?:\.\d+)?$/.test(subtotal)) {
      throw new TypeError("Refund line item is missing a valid subtotal.");
    }

    const productId = optionalText(rawLineItem?.product_id);

    return {
      productId: productId && /^\d+$/.test(productId) ? productId : null,
      subtotal,
      currencyCode: optionalText(shopMoney?.currency_code)?.toUpperCase() ?? null,
    };
  });

  return { refundGid, orderGid, lineItems };
}
