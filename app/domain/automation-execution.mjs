export function buildAutomationExecutionKey(shop, orderGid, ruleId) {
  const shopKey = String(shop ?? "").trim();
  const orderKey = String(orderGid ?? "").trim();
  const ruleKey = ruleId == null ? "" : String(ruleId).trim();

  if (!shopKey || !orderKey) {
    throw new TypeError("Shop and order identifiers are required for execution history.");
  }

  // Rule executions share the grant's event key. This makes the migration
  // backfill deterministic and preserves one record per order/rule pair.
  return ruleKey
    ? `fulfilled:${shopKey}:${orderKey}:${ruleKey}`
    : `automation-execution:${shopKey}:${orderKey}:NO_ACTIVE_RULES`;
}

export function classifyAutomationExecution({ conditionEvaluation, calculation }) {
  if (!conditionEvaluation || conditionEvaluation.matches !== true) {
    return { status: "CONDITION_MISMATCH", reason: "CONDITIONS_NOT_MET" };
  }
  if (!calculation || calculation.eligible !== true) {
    return {
      status: "NOT_ELIGIBLE",
      reason: calculation?.reason || "REWARD_NOT_ELIGIBLE",
    };
  }
  return { status: "PROCESSING", reason: "REWARD_ELIGIBLE" };
}
