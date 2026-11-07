import { performance } from "node:perf_hooks";
import { resolveActModulesWithChecks } from "./act-map-resolver.js";
import { rankDomains } from "./domain-module-map.js";
import { criminalMatter } from "./matter-signals.js";
import type { LexSkillRegistry } from "./registry.js";
import { resolveAdditionalSkills } from "./skill-selection.js";
import { registryFlashRoutes } from "./turn-gate.js";
import { isDomainSkill } from "./jurisdiction.js";

// Measured 2026-11-04 (simulated model, HTTP path): the first legal question after start spent
// 2.5-4 s in the runtime before the model call - the act-map index of all MAPA-AKTOW.md files
// (2.3 s), the domain ranking and the criminal signals compiled on first use; the next turns
// 20-40 ms. Built here in the background right after start, the user's first question waits
// for none of it. Indexes rebuild themselves after a skill update (file stamps).
const SAMPLE =
  "Sąsiad zalał mi mieszkanie i nie chce zapłacić odszkodowania. Kolega pobił mnie na imprezie. " +
  "Wojewoda nie wydał decyzji o pobyt. Pracodawca wypowiedział umowę o pracę.";

export function warmChatPaths(registry: LexSkillRegistry, sample = SAMPLE): number {
  const started = performance.now();
  const steps: Array<() => unknown> = [
    () => resolveActModulesWithChecks(registry, sample),
    () => rankDomains(registry, registryFlashRoutes(registry), sample),
    () => criminalMatter(sample),
    () => {
      const domain = [...registry.skills.keys()].filter((name) => isDomainSkill(name)).sort()[0];
      return domain ? resolveAdditionalSkills(registry, sample, domain, true, []) : null;
    }
  ];
  for (const step of steps) {
    try {
      step();
    } catch {
      // A warm-up failure only leaves the work to the first question.
    }
  }
  return Math.round(performance.now() - started);
}
