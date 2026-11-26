import test from "node:test";
import assert from "node:assert/strict";

import {
  getRewardRuleTemplate,
  listRewardRuleTemplates,
} from "../app/domain/reward-rule-templates.mjs";

test("templates use only supported paused-rule builder fields", () => {
  const templates = listRewardRuleTemplates();
  assert.equal(templates.length, 5);

  for (const template of templates) {
    const form = getRewardRuleTemplate(template.id);
    assert.ok(form.name);
    assert.ok(form.description);
    assert.equal(form.productMode === "INCLUDE" && form.productIds.length === 0, template.id === "selected-products");
    assert.equal(form.conditions.version, 2);
  }
});

test("product launch template requires a merchant product selection", () => {
  const template = getRewardRuleTemplate("selected-products");
  assert.equal(template.productMode, "INCLUDE");
  assert.deepEqual(template.productIds, []);
  assert.equal(template.rewardBase, "ELIGIBLE_ITEMS");
});

test("template results are isolated editable copies", () => {
  const first = getRewardRuleTemplate("welcome");
  first.conditions.groups[0].rules[0].value = "99";
  assert.equal(getRewardRuleTemplate("welcome").conditions.groups[0].rules[0].value, "1");
  assert.equal(getRewardRuleTemplate("missing"), null);
});
