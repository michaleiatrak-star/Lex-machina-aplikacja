import { expect, it } from "vitest";
import fs from "node:fs";
import { buildStatus } from "../scripts/i18n-status.mjs";

it("status.json matches the code and catalogs (node scripts/i18n-status.mjs)", () => {
  const saved = fs.readFileSync(new URL("./locales/status.json", import.meta.url), "utf8");
  expect(saved).toBe(`${JSON.stringify(buildStatus(), null, 1)}\n`);
});
