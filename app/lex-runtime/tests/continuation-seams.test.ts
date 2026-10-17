import { describe, expect, it } from "vitest";
import { joinContinuation } from "../src/providers/continuation-seams.js";
import { claudeContinuedText, parseClaudeResult } from "../src/providers/account-session.js";

describe("łączenie odpowiedzi kontynuowanej po limicie", () => {
  it.each([
    ["powtórzony wiersz", "1. Pierwszy ustęp.\n2. Drugi ustęp", "2. Drugi ustęp jest dłuższy.\n3. Trzeci.", "1. Pierwszy ustęp.\n2. Drugi ustęp jest dłuższy.\n3. Trzeci."],
    ["litery w środku wyrazu", "zgłoszona Zarządc", "cy, który zablokuje", "zgłoszona Zarządcy, który zablokuje"],
    ["dwie litery", "umowa przedwstęp", "tępna zostaje", "umowa przedwstępna zostaje"],
    ["podwojenie możliwe po polsku zostaje", "Wydział Gospodarczy", " w Krakowie", "Wydział Gospodarczy w Krakowie"],
    ["bez nakładania", "§ 6. Koniec.", "\n\n§ 7. Dalej", "§ 6. Koniec.\n\n§ 7. Dalej"]
  ])("%s", (_name, text, next, joined) => {
    expect(joinContinuation(text, next)).toBe(joined);
  });
});

const line = (event: unknown) => JSON.stringify(event);
const assistant = (text: string) => line({ type: "assistant", message: { content: [{ type: "text", text }] } });
const resume = line({ type: "user", message: { content: [{ type: "text", text: "Output token limit hit. Resume directly — no apology." }] } });

describe("Claude CLI po limicie wyjścia: cała odpowiedź, nie ostatnia porcja", () => {
  it("porcje połączone wiadomościami wznowienia", () => {
    const stdout = [
      line({ type: "system", subtype: "init" }),
      assistant("@SEKCJA: § 1. Start\n1. Treść pierwsza zgłoszona Zarządc"),
      resume,
      assistant("cy.\n@SEKCJA: § 2. Dalej\n1. Druga"),
      resume,
      assistant(" treść.\n@PODPIS:\nZarząd"),
      line({ type: "result", subtype: "success", is_error: false, result: " treść.\n@PODPIS:\nZarząd", session_id: "s1" })
    ].join("\n");
    expect(claudeContinuedText(stdout)?.pieces).toBe(3);
    expect(parseClaudeResult(stdout)?.text).toBe("@SEKCJA: § 1. Start\n1. Treść pierwsza zgłoszona Zarządcy.\n@SEKCJA: § 2. Dalej\n1. Druga treść.\n@PODPIS:\nZarząd");
  });

  it("tekst przed wywołaniem narzędzia nie jest doklejany", () => {
    const stdout = [
      assistant("Sprawdzę przepis."),
      line({ type: "assistant", message: { content: [{ type: "tool_use", name: "x", input: {} }] } }),
      line({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } }),
      assistant("Odpowiedź końcowa."),
      line({ type: "result", subtype: "success", is_error: false, result: "Odpowiedź końcowa." })
    ].join("\n");
    expect(parseClaudeResult(stdout)?.text).toBe("Odpowiedź końcowa.");
  });
});

describe("ucięte pismo nie staje się plikiem", async () => {
  const { isTruncatedLetter, letterMarkupAst } = await import("../src/letter-markup.js");
  const head = "@MIEJSCE_DATA: Kraków, dnia 16 października 2026 r.\n@TYTUL: POZEW O ZAPŁATĘ\n@SEKCJA: I. Żądania\n1. wnoszę o zasądzenie kwoty 10 000 zł;\n";
  it.each([
    ["dopisek o ucięciu", head + "@SEKCJA: II. Uzasadnienie\nPowód zawarł\n\n[ODPOWIEDŹ UCIĘTA: model osiągnął limit długości odpowiedzi także po kontynuacji.]", true],
    ["urwane w pół zdania, bez podpisu", head + "@SEKCJA: II. Uzasadnienie\nPowód zawarł z pozwanym umowę, na mocy której", true],
    ["pełne z podpisem", head + "@SEKCJA: II. Uzasadnienie\nPowód zawarł umowę.\n@PODPIS:\nJan Kowalski", false],
    ["bez podpisu, ale zakończone zdaniem (pole do uzupełnienia)", head + "@SEKCJA: II. Uzasadnienie\nPowód zawarł umowę.", false]
  ])("%s", (_name, text, cut) => {
    expect(isTruncatedLetter(text, "pleading")).toBe(cut);
    if (cut) expect(() => letterMarkupAst(text, { documentType: "pleading", styleProfile: "lex-office-tnr-v1" })).toThrow("LETTER_MARKUP_TRUNCATED");
  });
});

describe("model lokalny: ucięcie na limicie wyjścia widoczne w tekście", async () => {
  const { readLocalSse, LENGTH_TRUNCATED_NOTE } = await import("../src/providers/ai-sdk-adapter.js");
  const sse = (finish: string) =>
    new Response(
      [`data: ${JSON.stringify({ choices: [{ delta: { content: "Pozew o zapłatę, na mocy" } }] })}`, `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}`, "data: [DONE]", ""].join("\n"),
      { headers: { "content-type": "text/event-stream" } }
    );
  it("finish_reason length przy długiej odpowiedzi: dopisek; krótki budżet (routing, JSON) bez dopisku", async () => {
    expect(await readLocalSse(sse("length"), undefined, undefined, true)).toBe("Pozew o zapłatę, na mocy" + LENGTH_TRUNCATED_NOTE);
    expect(await readLocalSse(sse("length"))).toBe("Pozew o zapłatę, na mocy");
    expect(await readLocalSse(sse("stop"), undefined, undefined, true)).toBe("Pozew o zapłatę, na mocy");
  });
});

describe("ucięty akapit napisany od nowa (szew między akapitami)", () => {
  it("odcina niedokończony akapit albo zdanie; całe zakończenie zostaje", async () => {
    const { unfinishedTail } = await import("../src/providers/continuation-seams.js");
    expect(unfinishedTail("§ 1. Postanowienia ogólne.\n§ 2. Zarządc")).toEqual({ kept: "§ 1. Postanowienia ogólne.\n", tail: "§ 2. Zarządc" });
    expect(unfinishedTail("Pierwsze zdanie. Drugie zdanie urwa")).toEqual({ kept: "Pierwsze zdanie. ", tail: "Drugie zdanie urwa" });
    expect(unfinishedTail("Całość.\n")).toBeNull();
    expect(unfinishedTail("bez granicy zdania urwa")).toBeNull();
  });

  it("dokleja przepisany akapit od jego początku; wstęp i powtórzony akapit odpadają", async () => {
    const { joinRewrittenTail } = await import("../src/providers/continuation-seams.js");
    const kept = "§ 1. Postanowienia ogólne.\n";
    const tail = "§ 2. Zarządca nieruchomości odpowiada za utrzym";
    const next = "Kontynuuję.\n§ 1. Postanowienia ogólne.\n§ 2. Zarządca nieruchomości odpowiada za utrzymanie części wspólnych.\n§ 3. Koszty.";
    expect(joinRewrittenTail(kept, tail, next)).toBe("§ 1. Postanowienia ogólne.\n§ 2. Zarządca nieruchomości odpowiada za utrzymanie części wspólnych.\n§ 3. Koszty.");
    // Only the cut words continued: joined to the whole text.
    expect(joinRewrittenTail(kept, tail, "anie części wspólnych.")).toBe("§ 1. Postanowienia ogólne.\n§ 2. Zarządca nieruchomości odpowiada za utrzymanie części wspólnych.");
    // Reworded: replaces the cut paragraph.
    expect(joinRewrittenTail(kept, tail, "§ 2. Za utrzymanie części wspólnych odpowiada zarządca.")).toBe("§ 1. Postanowienia ogólne.\n§ 2. Za utrzymanie części wspólnych odpowiada zarządca.");
  });

  it("continueAtLength prosi o akapit od nowa zamiast dokańczania w pół słowa", async () => {
    const { continueAtLength } = await import("../src/providers/ai-sdk-adapter.js");
    const sent: string[] = [];
    const result = await continueAtLength(
      { fullText: "§ 1. Postanowienia ogólne.\n§ 2. Zarządc", finishReason: "length" },
      async (messages) => {
        sent.push(messages.map((m) => m.content).join("|"));
        return { fullText: "§ 2. Zarządca odpowiada za części wspólne.\n§ 3. Koszty.", finishReason: "stop" };
      },
      [{ role: "user", content: "Napisz regulamin." }]
    );
    expect(result.fullText).toBe("§ 1. Postanowienia ogólne.\n§ 2. Zarządca odpowiada za części wspólne.\n§ 3. Koszty.");
    expect(sent[0]).toContain("|§ 1. Postanowienia ogólne.\n|");
    expect(sent[0]).toContain("zaczynał się od: „§ 2. Zarządc”");
  });
});
