import { describe, expect, it } from "vitest";
import { CaseLawSearchService } from "../src/case-law-search.js";
import { LEGAL_VERIFICATION_SYSTEM_APPENDIX } from "../src/verification-tool-runtime.js";
import { mandatoryPathInstructions, type MandatoryPathModel } from "../src/mandatory-path.js";

// "wyszukaj wyrok SN dotyczący grupy przestępczej" (2026-10-10): the answer gave a
// postanowienie; SAOS can be asked for SN judgments only.
describe("case-law search: court and form of the decision", () => {
  it("passes courtType and judgmentTypes to SAOS", async () => {
    let asked: URL | null = null;
    const service = new CaseLawSearchService(async (input) => {
      asked = new URL(String(input));
      return new Response(JSON.stringify({ items: [], info: { totalResults: 0 } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await service.search({ source: "SAOS", query: "zorganizowana grupa przestępcza", saos: { courtType: "SUPREME", judgmentType: "SENTENCE" } });
    expect(asked!.searchParams.get("courtType")).toBe("SUPREME");
    expect(asked!.searchParams.get("judgmentTypes")).toBe("SENTENCE");
  });

  it("tells the model the order of sources and not to pass a postanowienie off as a wyrok", () => {
    expect(LEGAL_VERIFICATION_SYSTEM_APPENDIX).toContain("never present a postanowienie or uchwała as a wyrok");
    expect(LEGAL_VERIFICATION_SYSTEM_APPENDIX).toMatch(/only then web_search[\s\S]*verify_case_reference before it is cited/);
  });

  it("asks for CN-GATE and REM-GATE only for a ruling with a cited provision", () => {
    const model = {
      source: "shared/PROFIL-LEKKI.md",
      full: [
        { block: "CN-GATE", steps: ["CN-1"], resource: "shared/modules/MOD-CN-GATE.md" },
        { block: "REM-GATE", steps: ["REM-0"], resource: "shared/modules/MOD-REM-GATE.md" }
      ]
    } as unknown as MandatoryPathModel;
    const text = mandatoryPathInstructions(model, "PELNY", []);
    expect(text).toMatch(/CN-GATE[^\n]*przy samym wyszukaniu lub weryfikacji orzeczenia bloku nie pisz/);
    expect(text).toMatch(/REM-GATE[^\n]*przy samym wyszukaniu lub weryfikacji orzeczenia bloku nie pisz/);
  });
});
