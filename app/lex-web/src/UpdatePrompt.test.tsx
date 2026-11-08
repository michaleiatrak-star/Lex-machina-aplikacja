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
    expect(html).toContain("Pobierz aktualizację");
    expect(html).not.toContain("Zainstaluj i uruchom ponownie");
    expect(html).toContain("Później");
    expect(html).toContain("Pomiń tę wersję");
  });
});

describe("nieudana poprzednia próba aktualizacji", () => {
  it("podaje przyczynę dla tej samej wersji, a dla innej nic", async () => {
    const { failedUpdateMessage } = await import("./update-prompt.js");
    const attempt = { state: "REJECTED" as const, targetVersion: "0.1.52", lastError: "UPDATE_INSTALLER_PRODUCT_VERSION_MISMATCH:expected=0.1.52 actual=0.1.51", at: null };
    expect(failedUpdateMessage(attempt, "0.1.52")).toContain("pobrany instalator ma inną wersję niż zapowiedziana");
    expect(failedUpdateMessage(attempt, "0.1.53")).toBeNull();
    expect(failedUpdateMessage({ ...attempt, state: "ROLLED_BACK", lastError: "UPDATE_POSTCHECK_FAILED:1" }, "0.1.52")).toContain("przywrócono poprzednią wersję");
  });
});

describe("aktualizacja od razu po wydaniu", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), removeItem: (key: string) => void data.delete(key) };
  };
  const available = (version: string) => ({ status: "AVAILABLE", currentVersion: "0.1.55", checkedAt: "2026-11-03T12:00:00.000Z", latestVersion: version }) as never;

  it("nowsza wersja znaleziona w trakcie pracy jest proponowana od razu, nie przy następnym starcie", async () => {
    const { updateOfferAfterCheck } = await import("./update-prompt.js");
    expect(updateOfferAfterCheck(memory(), available("0.1.56"), null, "0.1.55")?.version).toBe("0.1.56");
    expect(updateOfferAfterCheck(null, available("0.1.56"), null, "0.1.55")?.version).toBe("0.1.56");
  });

  it("„Później” i „Pomiń tę wersję” są uszanowane; ta sama lub starsza wersja nie jest proponowana", async () => {
    const { updateOfferAfterCheck, skipUpdateVersion } = await import("./update-prompt.js");
    expect(updateOfferAfterCheck(memory(), available("0.1.56"), "0.1.56", "0.1.55")).toBeNull();
    const store = memory();
    skipUpdateVersion(store, "0.1.56");
    expect(updateOfferAfterCheck(store, available("0.1.56"), null, "0.1.55")).toBeNull();
    expect(updateOfferAfterCheck(store, available("0.1.57"), null, "0.1.55")?.version).toBe("0.1.57");
    expect(updateOfferAfterCheck(memory(), available("0.1.55"), null, "0.1.55")).toBeNull();
  });
});
