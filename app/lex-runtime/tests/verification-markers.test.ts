import { describe, expect, it } from "vitest";
import {
  containsVerificationMarker,
  stripAstVerificationMarkers,
  stripVerificationMarkers
} from "../src/verification-markers.js";
import type { LegalDocumentAst } from "../src/legal-document-ast.js";

describe("verification markers in documents (STRIP-VER-GATE)", () => {
  it("removes every marker of the closed hierarchy and keeps the provision", () => {
    const text = [
      "Zgodnie z art. 5 KC ✅ [VER: https://eli.gov.pl/eli/DU/1964/93/ogl#art_5, 2026-09-15], umowa jest ważna.",
      "Art. 6 KC 🟢 [VER-FRAGMENT: https://eli.gov.pl/, 2026-09-15] oraz art. 7 KC ⚠️ [NIEWERYFIKOWANE].",
      "Uchwała 🟨 [KOTWICA-URZĘDOWA: Dz.U. 2020 poz. 1] 📚 [TREŚĆ: RZĄD 2B — opis] i wyrok ✅ [CASE-QUOTE:0123456789abcdef0123].",
      "Teza 🔗 [CASE-SUPPORT:0123456789abcdef0123] 🔗 [KOTWICA-TEKSTOWA: „cytat”] 🟠 [KALIBRACJA] 🔴 [BLOKADA]."
    ].join("\n");
    const stripped = stripVerificationMarkers(text);
    expect(containsVerificationMarker(stripped)).toBe(false);
    expect(stripped).toBe(
      [
        "Zgodnie z art. 5 KC, umowa jest ważna.",
        "Art. 6 KC oraz art. 7 KC.",
        "Uchwała i wyrok.",
        "Teza."
      ].join("\n")
    );
  });

  it("keeps a gap to fill and ordinary brackets", () => {
    const text = "Kwota ⬛ [DO UZUPEŁNIENIA] zł [załącznik nr 1].";
    expect(stripVerificationMarkers(text)).toBe(text);
    expect(containsVerificationMarker(text)).toBe(false);
  });

  it("strips the markers from every text node of a document AST", () => {
    const ast: LegalDocumentAst = {
      schemaVersion: "1",
      documentType: "letter",
      locale: "pl-PL",
      styleProfile: "lex-classic-clean-v1",
      title: [{ type: "text", text: "Pozew ✅ [VER: https://eli.gov.pl/, 2026-09-15]" }],
      blocks: [
        { type: "paragraph", content: [{ type: "text", text: "Art. 5 KC " }, { type: "text", text: "✅ [VER: https://eli.gov.pl/, 2026-09-15]" }, { type: "text", text: "." }] },
        { type: "list", ordered: true, items: [[{ type: "text", text: "art. 6 KC ⚠️ [NIEWERYFIKOWANE]" }]] },
        { type: "table", rows: [[{ blocks: [{ type: "paragraph", content: [{ type: "text", text: "art. 7 KC 🟨 [KOTWICA-URZĘDOWA]" }] }] }]] }
      ]
    };
    const { ast: stripped, removed } = stripAstVerificationMarkers(ast);
    expect(removed).toBe(4);
    expect(JSON.stringify(stripped)).not.toMatch(/\[(?:VER|NIEWERYFIKOWANE|KOTWICA)/u);
    expect(stripped.title).toEqual([{ type: "text", text: "Pozew" }]);
    expect(stripped.blocks[0]).toEqual({ type: "paragraph", content: [{ type: "text", text: "Art. 5 KC" }, { type: "text", text: "." }] });
    expect(stripAstVerificationMarkers(stripped).removed).toBe(0);
  });
});
