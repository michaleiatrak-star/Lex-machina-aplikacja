import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compactForModel } from "../src/skill-sections.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const read = (file: string) => fs.readFileSync(path.join(CORPUS, file), "utf8");

// Instructions the application executes are not sent to the model (task 11): the anonymizer's
// gate (local pseudonymization), the mode detection, the host's widget rendering.
describe("router instructions executed by the application", () => {
  it("the router keeps no order to close the anonymizer gate nor to read its skill", () => {
    const { text, compacted } = compactForModel(read("prawny-router-v3/SKILL.md"));
    expect(text).not.toContain("zamknij bramkę anonimizera");
    expect(text).not.toContain("anonimizer-skill.md");
    expect(text).not.toContain("KROK 0A jest BRAMKĄ TWARDĄ");
    expect(text).not.toContain("NIE renderują się w claude.ai");
    expect(text).toContain("widgety: narzędzie show_widget aplikacji");
    expect(text.match(/\[wykonuje aplikacja: ANONIMIZER\]/gu)?.length).toBe(1);
    expect(compacted.filter((item) => item.component === "ANONIMIZER").length).toBeGreaterThanOrEqual(4);
    // The rest of the list stays.
    expect(text).toContain("`view references/KROK1-detekcja.md` — ustal tryb i jurysdykcję.");
  });

  it("a local model (no show_widget) keeps the widget section, without the anonymizer lines", () => {
    const { text } = compactForModel(read("prawny-router-v3/SKILL.md"), true, new Set(["WIDGET-HOST"]));
    expect(text).toContain("NIE renderują się w claude.ai");
    expect(text).not.toContain("anonimizer-skill.md");
  });

  it("KROK1: the mode detection goes, the hard gate of verification stays", () => {
    const { text } = compactForModel(read("prawny-router-v3/references/KROK1-detekcja.md"));
    expect(text).toContain("[wykonuje aplikacja: TRYB]");
    expect(text).toContain("KROK 1B");
    expect(text).toContain("### TRYB LAIK");
  });

  it("the files stay whole when compaction is off (the chat reads them as before)", () => {
    const raw = read("prawny-router-v3/SKILL.md");
    expect(compactForModel(raw, false).text).toBe(raw);
  });
});
