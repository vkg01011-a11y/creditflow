export function buildAutomationExecutionKey(shop, orderGid, ruleId) {
  const parts = [
    String(shop ?? "").trim(),
    String(orderGid ?? "").trim(),
    String(ruleId ?? "NO_ACTIVE_RULES").trim(),
  ];
  if (!parts[0] || !parts[1]) {
    throw new TypeError("Shop and order identifiers are required for execution history.");
  }
  return `automation-execution:${parts.map((part) => encodeURIComponent(part)).join(":")}`;
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
