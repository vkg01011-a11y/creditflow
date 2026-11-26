function condition(field, operator, value) {
  return { field, operator, value };
}

function group(logic, rules = []) {
  return { logic, rules };
}

const shared = {
  rewardType: "PERCENTAGE",
  percentage: "2",
  fixedAmount: "100",
  rewardBase: "ORDER_SUBTOTAL",
  minimumOrderValue: "",
  maximumReward: "",
  productMode: "ALL",
  productIds: [],
  requirePrepaid: false,
  expiryDays: "90",
  notifyCustomer: true,
  priority: "100",
};

const templates = [
  {
    id: "welcome",
    name: "Welcome cashback",
    description: "Give store credit on a customer’s first Shopify order, after it is fulfilled.",
    form: {
      ...shared,
      name: "Welcome cashback",
      description: "Reward a customer’s first Shopify order after it is fulfilled.",
      percentage: "5",
      maximumReward: "1000",
      priority: "10",
      conditions: {
        version: 2,
        logic: "AND",
        groups: [group("AND", [condition("CUSTOMER_ORDER_COUNT", "EQUALS", "1")])],
      },
    },
  },
  {
    id: "returning-customer",
    name: "Returning customer",
    description: "Reward orders where Shopify reports at least two lifetime orders, including the order being evaluated.",
    form: {
      ...shared,
      name: "Returning customer reward",
      description: "Reward returning customers after their order is fulfilled.",
      percentage: "3",
      conditions: {
        version: 2,
        logic: "AND",
        groups: [group("AND", [condition("CUSTOMER_ORDER_COUNT", "GREATER_THAN_OR_EQUAL", "2")])],
      },
    },
  },
  {
    id: "vip-customer",
    name: "VIP customer cashback",
    description: "Reward customers with at least four lifetime orders, including this order.",
    form: {
      ...shared,
      name: "VIP customer cashback",
      description: "Reward established customers after their order is fulfilled.",
      percentage: "5",
      maximumReward: "1000",
      priority: "20",
      conditions: {
        version: 2,
        logic: "AND",
        groups: [group("AND", [condition("CUSTOMER_ORDER_COUNT", "GREATER_THAN_OR_EQUAL", "4")])],
      },
    },
  },
  {
    id: "high-value-order",
    name: "High-value purchase",
    description: "Reward fulfilled orders with a subtotal of at least 5,000 in the shop’s currency.",
    form: {
      ...shared,
      name: "High-value purchase reward",
      description: "Reward larger orders after they are fulfilled.",
      percentage: "4",
      maximumReward: "1000",
      conditions: {
        version: 2,
        logic: "AND",
        groups: [group("AND", [condition("ORDER_SUBTOTAL", "GREATER_THAN_OR_EQUAL", "5000")])],
      },
    },
  },
  {
    id: "selected-products",
    name: "Product launch reward",
    description: "Choose products, then reward only their eligible value after fulfillment.",
    form: {
      ...shared,
      name: "Product launch reward",
      description: "Reward orders containing selected launch products.",
      percentage: "5",
      rewardBase: "ELIGIBLE_ITEMS",
      productMode: "INCLUDE",
      productIds: [],
      conditions: { version: 2, logic: "AND", groups: [group("AND")] },
    },
  },
];

export function listRewardRuleTemplates() {
  return templates.map(({ id, name, description }) => ({ id, name, description }));
}

export function getRewardRuleTemplate(id) {
  const template = templates.find((item) => item.id === id);
  return template ? structuredClone(template.form) : null;
}
