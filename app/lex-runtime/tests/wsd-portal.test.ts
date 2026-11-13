import { describe, expect, it } from "vitest";
import { findWsdRuling, wsdNumber, wsdPrefetchPrompt, wsdResultLinks, type WsdFetch } from "../src/courts/wsd-portal.js";

const page = (signature: string) => `<html><head><title>Orzeczenie WSD</title></head><body><h1>Orzeczenie WSD z dnia 21 września 2022 r.</h1><article><p>Sygn. akt ${signature}</p><p>Adwokatowi nie wolno bowiem grozić postępowaniem karnym.</p></article></body></html>`;

function portal(results: Record<string, string[]>, pages: Record<string, string>): { fetchImpl: WsdFetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: WsdFetch = async (url, init) => {
    calls.push(`${init.method ?? "GET"} ${url}${init.body ? ` ${init.body}` : ""}`);
    if (url.includes("ajax.php")) {
      const number = new URLSearchParams(init.body ?? "").get("sygAK") ?? "";
      const links = (results[number] ?? []).map((slug) => `<a href="https://wsd.adwokatura.pl/rejestry/show/${slug}">x</a>`).join("");
      return { ok: true, status: 200, text: async () => `<table>${links}</table>` };
    }
    const slug = url.replace("https://wsd.adwokatura.pl/rejestry/show/", "");
    return pages[slug] ? { ok: true, status: 200, text: async () => pages[slug]! } : { ok: false, status: 404, text: async () => "" };
  };
  return { fetchImpl, calls };
}

describe("WSD portal (Portal Orzecznictwa Dyscyplinarnego Adwokatury)", () => {
  it("signature number and result links", () => {
    expect(wsdNumber("WSD 113/22")).toBe("113/22");
    expect(wsdNumber("SDI 9/12")).toBeNull();
    expect(wsdResultLinks(`<a href="/rejestry/show/orzeczenie-wsd-77-22-1">a</a><a href='https://wsd.adwokatura.pl/rejestry/show/b-2'>b</a>`)).toEqual([
      "https://wsd.adwokatura.pl/rejestry/show/orzeczenie-wsd-77-22-1",
      "https://wsd.adwokatura.pl/rejestry/show/b-2"
    ]);
  });

  it("searches by signature and accepts only a page that names it", async () => {
    const { fetchImpl, calls } = portal({ "77/22": ["inne-wsd-7-22-5", "orzeczenie-wsd-77-22-9"] }, { "inne-wsd-7-22-5": page("WSD 7/22"), "orzeczenie-wsd-77-22-9": page("WSD 77/22") });
    const found = await findWsdRuling("WSD 77/22", fetchImpl);
    expect(found.status).toBe("FOUND");
    expect(found.status === "FOUND" && found.url).toBe("https://wsd.adwokatura.pl/rejestry/show/orzeczenie-wsd-77-22-9");
    expect(found.status === "FOUND" && found.text).toContain("nie wolno bowiem grozić");
    expect(calls[0]).toContain("POST https://wsd.adwokatura.pl/ajax.php?m=aktyPrawne&o=listAkty&pp=1&idm=19");
    expect(calls[0]).toContain("sygAK=77%2F22");
  });

  it("no hit, and a portal error, are said as such for the model", async () => {
    const { fetchImpl } = portal({}, {});
    const missing = await findWsdRuling("WSD 128/17", fetchImpl);
    expect(missing.status).toBe("NOT_FOUND");
    const down = await findWsdRuling("WSD 113/22", async () => ({ ok: false, status: 504, text: async () => "" }));
    expect(down).toEqual({ status: "UNAVAILABLE", signature: "WSD 113/22", detail: "WSD_SEARCH_504" });
    const prompt = wsdPrefetchPrompt([missing, down]);
    expect(prompt).toMatch(/WSD 128\/17: NIE ZNALEZIONO w portalu orzecznictwa WSD/u);
    expect(prompt).toMatch(/WSD 113\/22: portal WSD niedostępny \(WSD_SEARCH_504\)/u);
  });
});

describe("markers: one per place", () => {
  it("a signature inside a longer one already marked gets no second marker", async () => {
    const { markUnverifiedReferences, OFFICIAL_ANCHOR_MARKER_TEXT } = await import("../src/finalization-gate.js");
    const line = "XII Kp 176/20 oraz Kp 176/20 — nie są trafieniami.";
    const finding = (claim: string) => ({ status: "UNVERIFIED_NOT_MARKED", reference: { kind: "case", claim, line: 1, lineText: line } });
    const report = { findings: [finding("XII Kp 176/20"), finding("Kp 176/20")] } as never;
    const out = markUnverifiedReferences(line, report, new Set(), new Set(["XII Kp 176/20", "Kp 176/20"]));
    expect(out.split(OFFICIAL_ANCHOR_MARKER_TEXT).length - 1).toBeLessThanOrEqual(2);
    expect(out).not.toContain(`${OFFICIAL_ANCHOR_MARKER_TEXT} ${OFFICIAL_ANCHOR_MARKER_TEXT}`);
  });
});
