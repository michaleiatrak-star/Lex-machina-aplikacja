import { describe, expect, it } from "vitest";
import { rememberSupremeCourtCopy, storedSupremeCourtCopy } from "../src/verification-tool-runtime.js";
import { saosCovers, saosPrefetchPrompt } from "../src/courts/saos-text.js";

describe("SN decision copied from sn.pl, reused when sn.pl asks for its check again", () => {
  it("the copy of this run is found by its signature in any spelling", () => {
    rememberSupremeCourtCopy({ signature: "SDI 9/12", cardUrl: "https://www.sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=X1", fetchedAt: "2026-11-12T10:00:00Z", text: "WYROK Z DNIA 10 MAJA 2012 R. SDI 9/12 …", date: "2012-05-10" });
    expect(storedSupremeCourtCopy("sdi  9/12")?.cardUrl).toBe("https://www.sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=X1");
    expect(storedSupremeCourtCopy("SDI 9/13")).toBeNull();
  });
});

describe("SAOS text of rulings the case file cites", () => {
  it("covers SN up to 2016 and the common courts", () => {
    expect(saosCovers("SDI 9/12", "SN")).toBe(true);
    expect(saosCovers("II CSKP 89/26", "SN")).toBe(false);
    expect(saosCovers("XII Kp 176/20", "POWSZECHNY")).toBe(true);
  });
  it("prompt carries the text and the rank", () => {
    const prompt = saosPrefetchPrompt([{ signature: "SDI 9/12", status: "FOUND", url: "https://www.saos.org.pl/judgments/98038", court: "Sąd Najwyższy", date: "2012-05-10", text: "nie wolno ani pisemnie ani nawet ustnie" }, { signature: "VIII W 633/25", status: "NOT_FOUND", detail: "NO_EXACT_CASE_NUMBER" }]);
    expect(prompt).toContain("RZĄD 3");
    expect(prompt).toContain("nie wolno ani pisemnie ani nawet ustnie");
    expect(prompt).toContain("VIII W 633/25: SAOS — brak dokładnego trafienia");
  });
});
