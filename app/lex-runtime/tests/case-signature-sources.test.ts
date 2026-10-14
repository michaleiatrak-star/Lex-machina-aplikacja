import path from "node:path";
import { expect, it } from "vitest";
import { SEMANTIC_JUDGE_SYSTEM } from "../src/case-semantic-check.js";
import { LegalFederationToolRuntime } from "../src/legal-federation-tool-runtime.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { NormalizedToolCall, NormalizedToolResult } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
// G8 and case signatures by their source, over a real turn: from the model's memory (with or
// without "sygn.") blocks; returned by an official database in this turn 🟨 (snapshot, no
// promotion); a related proceeding named in the files or the messages ⚠️; the case's own
// number from a header line passes; "PIT 11/2024" is no signature.
type Case = { name: string; q: string; answer: string; fetched?: string; doc?: string; expect: "BLOCKED" | "PRESENTABLE"; mark?: string };
const CASES: Case[] = [
  { name: "A pamięć SN bez sygn.", q: "Jaki jest termin przedawnienia roszczeń o zachowek?", answer: "Zgodnie z uchwałą SN z 2021 r., III CZP 12/21, roszczenie przedawnia się z upływem 5 lat.", expect: "BLOCKED" },
  { name: "B pamięć SN z sygn.", q: "Jaki jest termin przedawnienia roszczeń o zachowek?", answer: "Zgodnie z uchwałą SN, sygn. akt III CZP 12/21, roszczenie przedawnia się.", expect: "BLOCKED" },
  { name: "C CBOSA pobrany", q: "Znajdź wyrok WSA o bezczynności w udostępnieniu informacji publicznej.", fetched: JSON.stringify({ sygnatura: "II SAB/Po 175/26", tresc: "Sprawa ze skargi na bezczynność Burmistrza w przedmiocie udostępnienia informacji publicznej." }), answer: "Wyrok WSA w Poznaniu II SAB/Po 175/26 dotyczy bezczynności burmistrza w udostępnieniu informacji publicznej.", expect: "PRESENTABLE", mark: "🟨" },
  { name: "D SAOS sąd powszechny pobrany", q: "Znajdź wyrok sądu apelacyjnego o karze umownej.", fetched: JSON.stringify({ sygnatura: "I ACa 123/22", tresc: "Kara umowna podlega miarkowaniu, gdy jest rażąco wygórowana." }), answer: "Sąd Apelacyjny (I ACa 123/22) uznał, że kara umowna podlega miarkowaniu, gdy jest rażąco wygórowana.", expect: "PRESENTABLE", mark: "🟨" },
  { name: "E powiązana sprawa z akt", q: "Oceń wpływ wyroku karnego na moją sprawę o odszkodowanie.", doc: "POZEW O ODSZKODOWANIE\nPowód: Jan Nowak\nPozwany: Adam Kowalski\nUzasadnienie\nPozwany został skazany prawomocnym wyrokiem Sądu Rejonowego w Krakowie z dnia 3.03.2024 r., sygn. akt II K 345/24, za czyn z art. 157 § 1 k.k.", answer: "Skazanie w sprawie sygn. akt II K 345/24 wiąże sąd cywilny co do popełnienia przestępstwa.\nPodstawa: art. 11 KPC ⚠️ [NIEWERYFIKOWANE].", expect: "PRESENTABLE", mark: "⚠️" },
  { name: "F własna sprawa z nagłówka", q: "Co mam zrobić z tym zarządzeniem?", doc: "Sąd Rejonowy w Krakowie I Wydział Cywilny\nSygn. akt I C 900/26\nZARZĄDZENIE\nPrzewodniczący zarządza doręczyć pozwanemu odpis pozwu.", answer: "W sprawie I C 900/26 należy złożyć odpowiedź na pozew.", expect: "PRESENTABLE" },
  { name: "G powiązana sprawa z wiadomości", q: "Toczy się też moja sprawa II Ns 55/25 o zasiedzenie. Czy wpływa na eksmisję?", answer: "Postępowanie II Ns 55/25 o zasiedzenie może być prejudycjalne dla sprawy o eksmisję.", expect: "PRESENTABLE", mark: "⚠️" },
  { name: "H TK pobrany", q: "Co orzekł TK w sprawie K 3/21?", fetched: JSON.stringify({ sygnatura: "K 3/21", tresc: "Trybunał Konstytucyjny orzekł o niezgodności przepisów." }), answer: "Trybunał Konstytucyjny w sprawie K 3/21 orzekł o niezgodności przepisów.", expect: "PRESENTABLE", mark: "🟨" },
  { name: "I fałszywe trafienia", q: "Jak rozliczyć PIT?", answer: "Formularz PIT 11/2024 wystawia płatnik do końca lutego. Zob. Dz.U. 2024 poz. 1061 ⚠️ [NIEWERYFIKOWANE].", expect: "PRESENTABLE" },
  { name: "J pamięć NSA bez sygn.", q: "Opłata adiacencka a podział nieruchomości?", answer: "NSA w wyroku I OSK 1234/19 uznał, że opłata adiacencka wymaga ostatecznej decyzji podziałowej.", expect: "BLOCKED" },
  { name: "K pamięć sąd powszechny bez sygn.", q: "Czy kara umowna podlega miarkowaniu?", answer: "Sąd Apelacyjny w Warszawie w wyroku VI ACa 999/20 przyjął, że tak.", expect: "BLOCKED" }
];
it("checks case signatures by their source", async () => {
  const registry = new LexSkillRegistry(CORPUS); registry.scan();
  for (const c of CASES) {
    class Fed extends LegalFederationToolRuntime {
      override async runTools(calls: NormalizedToolCall[]): Promise<NormalizedToolResult[]> {
        return calls.map((call) => ({ tool_use_id: call.id, content: c.fetched ?? "{}" }));
      }
    }
    let n = 0;
    const providers = new ProviderRegistry();
    providers.register({ id: "openai", label: "sig", capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(received: any) {
        if (String(received.systemPrompt).startsWith(SEMANTIC_JUDGE_SYSTEM)) return { fullText: "" };
        n += 1;
        if (n === 1 && c.fetched) await received.runTools?.([{ id: "f1", name: "get_federated_legal_document", input: { source: "cbosa", documentId: "X1" } }]);
        return { fullText: c.answer };
      } } as never);
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, undefined, undefined, new Fed());
    const documentAttachments = c.doc ? [{ documentId: "doc_a", title: "a.pdf", selectedByUser: true, totalPages: 1, chunks: [{ index: 0, pageStart: 1, pageEnd: 1, text: c.doc }] }] : undefined;
    const result: any = await executor.execute({ query: c.q, provider: "openai", model: "account/openai/default", primarySkill: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa", modelSelectsSkills: true, mode: "PRAWNIK", ...(documentAttachments ? { documentAttachments } : {}) } as never).catch((e: unknown) => ({ status: "EXCEPTION", error: String(e) }));
    const presentable = result.status === "DRAFT_PRESENTABLE";
    const sig = /([IVX]+ [A-Za-z]+(?:\/[A-Za-z]+)? \d+\/\d+|K \d+\/\d+)/u.exec(c.answer)?.[1] ?? ""; const ok = (c.expect === "PRESENTABLE") === presentable && (!c.mark || String(result.answer).includes(`${sig} ${c.mark}`));
    expect(ok, `${c.name}: ${result.status} ${String(result.answer ?? result.error).slice(0, 200)}`).toBe(true);
  }
}, 600_000);
