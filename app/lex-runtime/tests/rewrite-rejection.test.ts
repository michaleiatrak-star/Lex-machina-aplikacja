import { describe, expect, it } from "vitest";
import { rewriteRejection } from "../src/answer-corrections.js";

const letter = [
  "Sąd Okręgowy w Katowicach, XI Wydział Pracy. Sygn. akt XI P 27/26.",
  "Wnoszę o uwzględnienie stanowiska przy ocenie zeznań świadka [[LEXDOC:d1:0]] [[LEXDOC:d2:0]] [[LEXDOC:d1:1]] [[LEXDOC:d2:1]].",
  "Uzasadnienie. ".repeat(120)
].join("\n");

describe("a rewriting round replaces the answer only with an answer", () => {
  it("XI P 27/26: an announcement of work instead of the letter is rejected", () => {
    expect(rewriteRejection(letter, "Odtworzę pełną odpowiedź z kontekstu sprawy i naniosę wyłącznie wskazane korekty cytatu oraz tez o przepisach. Najpierw odczytam brakującą część zlecenia.")).not.toBeNull();
  });

  it("empty, too short, without the petitum or the file references: rejected", () => {
    expect(rewriteRejection(letter, "")).toBe("pusta odpowiedź");
    expect(rewriteRejection(letter, letter.slice(0, letter.length / 3))).toBe("krótsza niż 60% pierwszej wersji");
    expect(rewriteRejection(letter, letter.replace(/Wnoszę/u, "Proszę"))).toBe("bez wniosków, które miała pierwsza wersja");
    expect(rewriteRejection(letter, letter.replace(/\[\[LEXDOC:[^\]]+\]\]/gu, ""))).toBe("utracone odwołania do akt");
  });

  it("the corrected letter is accepted", () => {
    expect(rewriteRejection(letter, letter.replace("ocenie", "wszechstronnej ocenie"))).toBeNull();
  });
});

import { applyPointEdits } from "../src/answer-corrections.js";

describe("point edits instead of a rewrite of the whole answer", () => {
  const answer = "Świadek zeznał: „Było to najprawdopodobniej 29 września 2024 r.” [[LEXDOC:d:0]]. Art. 233 § 2 k.p.c. dotyczy odmowy przedstawienia dowodu.";
  it("each fragment found once is replaced; others are skipped", () => {
    const reply = [
      '{"bylo": "Było to najprawdopodobniej 29 września 2024 r.", "ma_byc": "Było to najprawdopodobniej 29 września 2024r."}',
      '{"bylo": "fragment, którego nie ma w odpowiedzi", "ma_byc": "x"}',
      "komentarz modelu"
    ].join("\n");
    const result = applyPointEdits(answer, reply);
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.text).toContain("29 września 2024r.”");
    expect(result.text).toContain("Art. 233 § 2");
  });
  it("an empty replacement removes the fragment", () => {
    expect(applyPointEdits(answer, '{"bylo": " Art. 233 § 2 k.p.c. dotyczy odmowy przedstawienia dowodu.", "ma_byc": ""}').text).not.toContain("Art. 233");
  });
});

describe("drafted documents keep their units through a correcting round", () => {
  const contract = ["UMOWA", ...Array.from({ length: 8 }, (_, index) => `§ ${index + 1}\nTreść paragrafu ${index + 1} umowy o świadczenie usług, ze szczegółami obowiązków stron.`)].join("\n");
  it("a contract that lost paragraphs is rejected; the same contract corrected is accepted", () => {
    expect(rewriteRejection(contract, contract.split("§ 6")[0]!.padEnd(contract.length, " "))).toBe("utracone jednostki dokumentu (paragrafy, artykuły, punkty)");
    expect(rewriteRejection(contract, contract.replace("świadczenie usług", "świadczenie usług prawnych"))).toBeNull();
  });
});
