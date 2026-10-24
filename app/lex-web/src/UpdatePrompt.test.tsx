import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./update-prompt.js", async (original) => ({
  ...(await original<typeof import("./update-prompt.js")>()),
  updateStore: () => null,
  startupUpdate: () => ({ version: "0.1.47", releaseUrl: "https://github.com/michaleiatrak-star/Lex-machina-aplikacja/releases/tag/v0.1.47", detectedAt: "2026-10-24T08:00:00.000Z" })
}));

describe("UpdatePrompt", () => {
  it("pyta wprost o aktualizację do wykrytej wersji", async () => {
    const { UpdatePrompt } = await import("./UpdatePrompt.js");
    const html = renderToStaticMarkup(<UpdatePrompt />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Dostępna jest nowa wersja Lex Machina");
    expect(html).toContain("0.1.47");
    expect(html).toContain("Zaktualizuj teraz");
    expect(html).toContain("Później");
    expect(html).toContain("Pomiń tę wersję");
  });
});
