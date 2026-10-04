import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import { classifyDocument } from "../src/document-kind.js";
import { classifyTask, decideTask, parseActivationMatrix, parseRoutingTable } from "../src/task-routing.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const routes = parseRoutingTable(fs.readFileSync(path.join(CORPUS, "prawny-router-v3/SKILL.md"), "utf8"));

describe("router KROK 2 table from the corpus", () => {
  it("reads rows [1]–[11] with their PRIMARY skill", () => {
    expect(routes.map((route) => route.id)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
    expect(routes.find((route) => route.id === "3")!.primary).toBe("pisma-procesowe-v3");
    expect(routes.find((route) => route.id === "11")!.phrases.length).toBeGreaterThan(3);
  });

  it.each([
    ["Napisz apelację od wyroku sądu rejonowego", "pisma-procesowe-v3"],
    ["Napisz sprzeciw od nakazu zapłaty", "pisma-proste-v2"],
    ["Przeanalizuj tę umowę najmu, czy mogę podpisać?", "analizator-umow-v1"],
    ["Dostałem nakaz zapłaty, jakie mam szanse?", "analiza-sadowa-v6"],
    ["Znajdź wyrok SN o zasiedzeniu", "orzeczenia-sadowe-v2"],
    ["Mam maile i SMS-y od pracodawcy, czy to dowód?", "analizator-dowodow-v3"],
    ["Przygotuj pytania do świadka", "przesluchanie-swiadkow-v2-min90"],
    ["Wykaż różnice pomiędzy 233 kk, 234 kk i 238 kk.", "analizator-przepisow-v2"],
    ["Sprawdź tę opinię prawną", "analizator-przepisow-v2"]
  ])("%s -> %s", (question, skill) => {
    expect(classifyTask(routes, question)?.route.primary).toBe(skill);
  });

  it("a plain domain question names no executive skill", () => {
    expect(classifyTask(routes, "Sąsiad uszkodził mi samochód, należy mi się odszkodowanie?")).toBeNull();
  });
});

describe("AUTO: the router's executive skill is loaded mechanically", () => {
  it("loads pisma-procesowe-v3 with its contract for an appeal and registers it", async () => {
    const registry = new LexSkillRegistry(CORPUS);
    registry.scan();
    const calls: ProviderStreamParams[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "auto",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(received) {
        calls.push(received);
        return { fullText: "Apelację wnosi się za pośrednictwem sądu pierwszej instancji." };
      }
    });
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
    const result = await executor.execute({
      query: "Napisz apelację od wyroku sądu rejonowego w sprawie o zapłatę",
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa",
      modelSelectsSkills: true,
      mode: "PRAWNIK"
    });
    const prompt = calls[0]!.systemPrompt ?? "";
    expect(prompt).toContain("# SKILL WYKONAWCZY WG ROUTERA: pisma-procesowe-v3");
    expect(prompt).toContain("# KONTRAKT SKILLA WYKONAWCZEGO: pisma-procesowe-v3");
    expect(prompt).toContain("tryb mechaniczny");
    const steps = result.mandatoryPath!.steps;
    expect(steps.find((step) => step.id === "SKILL:pisma-procesowe-v3")).toMatchObject({ status: "MET", by: "APLIKACJA" });
    expect(steps.find((step) => step.id === "KONTRAKT:pisma-procesowe-v3")).toBeTruthy();
    expect(result.mandatoryPath!.routingTrace).toContain("PRIMARY: pisma-procesowe-v3 — ROUTER-WCZYTANY: TAK");
  }, 60_000);
});

describe("materials the user delivers (documents and evidence)", () => {
  const matrix = parseActivationMatrix(fs.readFileSync(path.join(CORPUS, "shared/ACTIVATION-MATRIX.md"), "utf8"));
  const kind = (text: string, images = 0) => ({ ...classifyDocument({ text, images }) });
  const judgment = kind("Sygn. akt I C 123/24\n\nWYROK\nW IMIENIU RZECZYPOSPOLITEJ POLSKIEJ");
  const invoice = kind("Faktura VAT nr 12/2024\nSprzedawca: [PII:ORG:0001]\nNabywca: [PII:ORG:0002]\nRazem brutto 1230,00 zł");
  const photo = kind("=== STRONA 1/1 ===", 1);
  const protocol = kind("PROTOKÓŁ ODBIORU\nW dniu 2 marca strony stwierdzają");
  const contract = kind("UMOWA NAJMU\nzawarta w dniu 1 lutego 2024 r.\n§ 1 Przedmiot");

  it("recognises court decisions, evidence and contracts", () => {
    expect([judgment, invoice, photo, protocol, contract].map((item) => item.kind)).toEqual(["WYROK", "FAKTURA", "ZDJECIE", "PROTOKOL", "UMOWA"]);
    expect([invoice, photo, protocol].every((item) => item.evidence)).toBe(true);
  });

  it("chooses the skill by what is delivered, as the activation matrix says", () => {
    expect(decideTask(routes, matrix, "Co mam zrobić?", [judgment])?.primary).toBe("analiza-sadowa-v6");
    expect(decideTask(routes, matrix, "Napisz apelację", [judgment])).toMatchObject({ primary: "analiza-sadowa-v6", then: "pisma-procesowe-v3" });
    expect(decideTask(routes, matrix, "Oceń te materiały", [invoice, photo, protocol])?.primary).toBe("analizator-dowodow-v3");
    expect(decideTask(routes, matrix, "Proszę o analizę", [contract])?.primary).toBe("analizator-umow-v1");
    // Evidence next to a judgment is not "evidence without a pleading".
    expect(decideTask(routes, matrix, "Oceń te materiały", [judgment, invoice])?.primary).toBe("analiza-sadowa-v6");
  });
});

describe("AUTO with an attached judgment", () => {
  it("recognises the document, tells the model and loads analiza-sadowa-v6", async () => {
    const registry = new LexSkillRegistry(CORPUS);
    registry.scan();
    const calls: ProviderStreamParams[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "auto",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(received) {
        calls.push(received);
        return { fullText: "Analiza wyroku." };
      }
    });
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
    await executor.execute({
      query: "Co mam zrobić z tym?",
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa",
      modelSelectsSkills: true,
      mode: "LAIK",
      documentAttachments: [
        {
          documentId: "doc_wyrok",
          selectedByUser: true,
          totalPages: 1,
          chunks: [{ index: 0, pageStart: 1, pageEnd: 1, text: "Sygn. akt I C 123/24\n\nWYROK\nW IMIENIU RZECZYPOSPOLITEJ POLSKIEJ\nSąd Rejonowy zasądza od pozwanego kwotę." }]
        }
      ]
    });
    const prompt = calls[0]!.systemPrompt ?? "";
    expect(prompt).toContain("# ROZPOZNANE MATERIAŁY");
    expect(prompt).toContain("doc_wyrok: wyrok");
    expect(prompt).toContain("# SKILL WYKONAWCZY WG ROUTERA: analiza-sadowa-v6");
  }, 60_000);
});
