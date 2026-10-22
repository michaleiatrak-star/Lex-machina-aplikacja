import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PLAIN_ERROR,
  loadDeveloperMode,
  phaseLabel,
  plainAnswerText,
  plainErrorMessage,
  plainMeta,
  plainStepLabel,
  plainSystemText,
  saveDeveloperMode,
  skillLabel,
  visibleContent
} from "./developer-mode.js";
import { PipelineChoices, blockedReasonText, providerFailureMessage } from "./MatterChatApp.js";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value))
  };
}

describe("tryb dewelopera: zapis per użytkownik", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("domyślnie wyłączony, zapamiętany osobno dla każdego użytkownika", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
    expect(loadDeveloperMode("u1")).toBe(false);
    saveDeveloperMode("u1", true);
    expect(loadDeveloperMode("u1")).toBe(true);
    expect(loadDeveloperMode("u2")).toBe(false);
    saveDeveloperMode("u1", false);
    expect(loadDeveloperMode("u1")).toBe(false);
  });

  it("bez dostępu do pamięci przeglądarki jest wyłączony", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        }
      }
    });
    expect(loadDeveloperMode("u1")).toBe(false);
  });
});

describe("tryb dewelopera: co widzi prawnik", () => {
  it("opis pod odpowiedzią bez routingu, skilli, tokenów, modelu i liczników bramek", () => {
    const meta =
      "routing: prawo polskie v2 · skille: pisma proste v2 · runtime 12 000 tok. · model: gpt-x · VERIFIED 3 · SUPPORTED 1";
    expect(plainMeta(meta)).toBe("");
    expect(plainMeta("dokument: pismo.docx")).toBe("dokument: pismo.docx");
    expect(plainMeta("automatycznie · Analiza umowy · krok AU-F0 — Intake: tryb, dokument i cel")).toBe(
      "automatycznie · Analiza umowy · krok Intake: tryb, dokument i cel"
    );
    expect(plainStepLabel("AU-GAP — Braki danych (INTAKE-GAP)", false)).toBe("Braki danych");
    expect(plainStepLabel("AU-GAP — Braki danych (INTAKE-GAP)", true)).toBe("AU-GAP — Braki danych (INTAKE-GAP)");
  });

  it("blokada odpowiedzi bez listy bramek i kodów", () => {
    const content =
      "Nie udało się zaprezentować odpowiedzi z powodu blokady wykonania lub wymaganego workflow. Sama niepełna weryfikacja źródeł nie blokuje już odpowiedzi." +
      blockedReasonText({ status: "BLOCKED", finalization: "BLOCKED", answer: null, audit: { result: "FAIL", missing: ["G39I"] } } as never);
    const plain = plainSystemText(content);
    expect(plain).not.toMatch(/G39I|status=|Przyczyna|audit/);
    expect(plain).toMatch(/Spróbuj ponownie/);
  });

  it("błąd dostawcy bez kodu i szczegółów technicznych", () => {
    const technical = providerFailureMessage("anthropic-account", "ACCOUNT_SESSION_CLI_FAILED", "exit 1 at spawn");
    expect(technical).toContain("ACCOUNT_SESSION_CLI_FAILED");
    const plain = plainErrorMessage("PROVIDER_EXECUTION_FAILED", technical, "ACCOUNT_SESSION_CLI_FAILED");
    expect(plain).not.toMatch(/ACCOUNT_SESSION|exit 1|Kod/);
    expect(plainErrorMessage("PROVIDER_EXECUTION_FAILED", technical, "ACCOUNT_SESSION_AUTH_EXPIRED")).toMatch(/Ustawienia → Modele i AI/);
    expect(plainErrorMessage("PROVIDER_EXECUTION_FAILED", "", "LOCAL_MODEL_CONTEXT_OVERFLOW")).toMatch(/Zawęź pytanie/);
  });

  it("nieznany kod: jedno zdanie, kody z działaniem: co zrobić", () => {
    expect(plainErrorMessage("G39I_GUIDE_STATE_BINDING", "Nie udało się wykonać sesji: G39I_GUIDE_STATE_BINDING")).toBe(PLAIN_ERROR);
    expect(plainErrorMessage("AUTO_ROUTING_FAILED", "Model nie zwrócił poprawnego wyboru domeny i skilli")).toBe(PLAIN_ERROR);
    expect(plainErrorMessage("PROCESS_PLEADING_GATE_X", "Pipeline pisma procesowego zablokował wykonanie: PROCESS_PLEADING_GATE_X")).not.toMatch(
      /PROCESS_PLEADING|Pipeline/
    );
    expect(plainErrorMessage("DOCUMENT_NOT_REVIEWED", "")).toMatch(/zatwierdź/);
    expect(plainErrorMessage("CONTRACT_STATE_REQUIRED", "")).toMatch(/Wybierz go poniżej/);
  });

  it("komunikaty systemowe: kody i nazwy walidacji usunięte, sens zostaje", () => {
    expect(plainSystemText("Nie udało się utworzyć pliku pisma: DOCX_FAIL · X. Możesz poprosić: „wygeneruj to w pliku docx”.")).toBe(
      "Nie udało się utworzyć pliku pisma. Możesz poprosić: „wygeneruj to w pliku docx”."
    );
    expect(plainSystemText("Lokalny model działa, ale żądanie przekroczyło kontekst. Kod: LOCAL_MODEL_CONTEXT_OVERFLOW")).toBe(
      "Lokalny model działa, ale żądanie przekroczyło kontekst."
    );
    expect(plainSystemText("Dokument nie został zapisany: walidacja HYBRID-VAL przed plikiem wykazała, że brak podpisu.")).not.toMatch(/HYBRID/);
    expect(plainSystemText("Nie udało się wykonać sesji: SOMETHING_BROKE")).toBe(PLAIN_ERROR);
  });

  it("odpowiedź: identyfikatory kroków zamienione na nazwy, treść prawna nietknięta", () => {
    const answer = "## CP-1a\n\nRoszczenie z art. 471 KC [VER].\n\n## CP-W1\n\nRama.";
    const plain = plainAnswerText(answer);
    expect(plain).toContain("## Weryfikacja roszczenia");
    expect(plain).toContain("## Rama pisma i strategia");
    expect(plain).toContain("Roszczenie z art. 471 KC [VER].");
    expect(plainAnswerText("⚠️ Weryfikacja źródeł lub śladu Gate I nie jest kompletna. Dalej")).not.toContain("Gate I");
  });

  it("widoczna treść zależy od trybu i roli", () => {
    const system = { role: "system", content: "Błąd. Kod: X_Y", plainContent: "Spróbuj ponownie." };
    expect(visibleContent(system, true)).toBe("Błąd. Kod: X_Y");
    expect(visibleContent(system, false)).toBe("Spróbuj ponownie.");
    const handoff = { role: "user", content: "Następny etap pipeline'u: pisma-procesowe-v3. Wynik powyżej jest zadowalający: przygotuj dokument." };
    expect(visibleContent(handoff, false)).toBe("Przygotuj dokument: pismo procesowe.");
    expect(visibleContent({ role: "user", content: "Mój tekst CP-1a" }, false)).toBe("Mój tekst CP-1a");
  });

  it("etapy pracy i skille ludzkimi słowami", () => {
    expect(phaseLabel("ROUTING", "Routing prawny (prawny-router-v3)", false)).toBe("Rozpoznanie zagadnienia prawnego");
    expect(phaseLabel("ROUTING", "Routing prawny (prawny-router-v3)", true)).toBe("Routing prawny (prawny-router-v3)");
    expect(skillLabel("analizator-umow-v1", false)).toBe("analiza umowy");
    expect(skillLabel("analizator-umow-v1", true)).toBe("analizator-umow-v1");
  });
});

describe("tryb dewelopera: wybór dalszego etapu", () => {
  const next = {
    skill: "analizator-dowodow-v3",
    reason: "dowody",
    choices: [{ skill: "analizator-dowodow-v3", kind: "ANALYSIS" as const, reason: "dowody" }]
  };

  it("wyłączony: bez nazw skilli i walidacji", () => {
    const html = renderToStaticMarkup(
      <PipelineChoices developer={false} next={next} auto disabled={false} onChoose={() => undefined} />
    );
    expect(html).toContain("Dalsza analiza: analiza dowodów");
    expect(html).not.toContain("analizator-dowodow-v3");
  });

  it("włączony: jak dotąd", () => {
    const html = renderToStaticMarkup(<PipelineChoices next={next} auto disabled={false} onChoose={() => undefined} />);
    expect(html).toContain("Dalsza analiza: analizator-dowodow-v3");
  });
});
