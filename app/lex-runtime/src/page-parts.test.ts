import { afterEach, describe, expect, it } from "vitest";
import { LegalFederationToolRuntime, clearPageMemoryForTest, pagePassages } from "./legal-federation-tool-runtime.js";

const filler = (n: number) => "Komentarz do przepisu o karze umownej. ".repeat(n);
const PAGE = `${filler(1500)} Sąd Najwyższy w wyroku z 19.01.2024 r., II CSKP 865/22, przyjął kryteria miarkowania. ${filler(1500)}`;

function runtime(pages: string[]): { tools: LegalFederationToolRuntime; fetched: string[] } {
  const fetched: string[] = [];
  const fetcher = {
    fetch: async (url: string) => {
      fetched.push(url);
      return { requestedUrl: url, finalUrl: url, contentType: "text/html", bytes: 1, sha256: "x", fetchedAt: "2026-11-15T00:00:00Z", text: pages.shift() ?? PAGE, redirectCount: 0 };
    }
  };
  return { tools: new LegalFederationToolRuntime(fetcher as never), fetched };
}

const call = async (tools: LegalFederationToolRuntime, input: Record<string, unknown>) =>
  JSON.parse((await tools.runTools([{ id: "f", name: "fetch_auxiliary_legal_source", input }]))[0]!.content) as {
    status: string;
    retrieval: { text: string; textLength: number; nextOffset?: number; passages?: number; offset?: number };
    instruction: string;
  };

afterEach(() => clearPageMemoryForTest());

describe("długie strony: części, fraza, pamięć", () => {
  it("strona w częściach po 40 000 znaków z nextOffset; druga część bez ponownego pobrania", async () => {
    const { tools, fetched } = runtime([PAGE]);
    const first = await call(tools, { url: "https://kancelaria.example.pl/kara" });
    expect(first.retrieval.text).toHaveLength(40_000);
    expect(first.retrieval.textLength).toBe(PAGE.length);
    expect(first.retrieval.nextOffset).toBe(40_000);
    expect(first.instruction).toContain("offset=40000");
    const second = await call(tools, { url: "https://kancelaria.example.pl/kara", offset: 40_000 });
    expect(second.retrieval.text).toBe(PAGE.slice(40_000, 80_000));
    expect(fetched).toHaveLength(1);
  });

  it("fraza: fragment wokół sygnatury z dalszej części strony", async () => {
    const { tools } = runtime([PAGE]);
    const found = await call(tools, { url: "https://kancelaria.example.pl/kara", find: "II CSKP 865/22" });
    expect(found.retrieval.passages).toBe(1);
    expect(found.retrieval.text).toContain("przyjął kryteria miarkowania");
    expect(found.retrieval.text.length).toBeLessThan(4_000);
  });

  it("fraza: wielkość liter i spacje bez znaczenia; brak trafień: pusty wynik", () => {
    expect(pagePassages("Art.  484 § 2 KC stanowi", "art. 484").passages).toBe(1);
    expect(pagePassages("tekst", "brak").passages).toBe(0);
  });
});
