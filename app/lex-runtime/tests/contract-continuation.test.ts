import { it, expect } from "vitest";
import { withEnvelopeWorkflow } from "../src/http/app.js";
import { parseSkillSelectionEnvelope, resolveAdditionalSkills } from "../src/skill-selection.js";
import { LexSkillRegistry } from "../src/registry.js";
import path from "node:path";
it("Kontynuuj. in a started contract analysis selects the contract workflow (live test 2026-11-26: 422 G39I_CONTRACT_STATE_BINDING)", () => {
  const r = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana")); r.scan();
  const q = withEnvelopeWorkflow('__LEX_SKILLS_V1__ {"auto":true,"manual":[],"caseType":"AUTO"}\nKontynuuj.', "analizator-umow-v1");
  const e = parseSkillSelectionEnvelope(q);
  const sel = resolveAdditionalSkills(r, e.query, "AUTO", e.automatic, e.manualSkills, e.domainAllowList, e.domainRestrictionActive, e.executionAllowList, e.executionRestrictionActive, e.workflowExecutionSkill);
  expect(sel.workflowExecutionSkill).toBe("analizator-umow-v1");
});
