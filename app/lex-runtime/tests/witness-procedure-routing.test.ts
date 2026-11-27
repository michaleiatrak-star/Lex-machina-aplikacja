import path from "node:path";
import { describe, expect, it } from "vitest";
import { TurnRouter } from "../src/routing-benchmark.js";

// User 2026-11-27: a witness in a civil case and in a criminal one. The witness skill in both; the
// criminal qualifier and DR-03 only for a criminal matter or a petty offence.
const router = new TurnRouter(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));

describe("a witness in a civil and in a criminal case", () => {
  it.each([
    ["Przygotuj pytania do świadka w sprawie karnej o kradzież z włamaniem", true, "dr-03-"],
    ["Przygotuj pytania do świadka oskarżenia w sprawie o pobicie, jestem obrońcą", true, "dr-03-"],
    ["Przygotuj pytania do świadka w sprawie o wykroczenie drogowe", true, "dr-03-"],
    ["Świadek jest bratem oskarżonego, czy może odmówić zeznań?", true, "dr-03-"],
    ["Przygotuj pytania do świadka w sprawie o zapłatę za roboty budowlane", false, null],
    ["Jakie pytania zadać świadkowi w sprawie o alimenty?", false, "dr-02-"],
    ["Świadek jest bratem powoda, czy może odmówić zeznań w sprawie o zapłatę?", false, "dr-02-"],
    ["Przygotuj pytania do świadka w sprawie o przywrócenie do pracy", false, "dr-04-"],
    ["Przesłuchanie świadka w postępowaniu administracyjnym — jakie ma prawa?", false, "dr-05-"]
  ] as const)("%s", (question, criminal, domain) => {
    const routed = router.route(question);
    expect(routed.executive).toBe("przesluchanie-swiadkow-v2-min90");
    expect(routed.criminal).toBe(criminal);
    if (domain) expect(routed.domains.some((name) => name.startsWith(domain))).toBe(true);
    if (!criminal) expect(routed.domains.some((name) => name.startsWith("dr-03-"))).toBe(false);
  });
});
