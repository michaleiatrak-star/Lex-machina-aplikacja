// court_for_address: the court of a party's address for a letter, decided by the application.
// The model never has the address (it sees [PII:ADDRESS:0001] or [LMPII:D01:ADDRESS:0001]): it
// passes the alias, the application restores it from the case's local vault, asks GUGiK for the
// address point and returns the courts with their seats, never the address itself.
import type { NormalizedToolCall, NormalizedToolSchema } from "../providers/types.js";
import { CASE_KINDS, type CaseKind } from "./court-base.js";
import { locateCourt, type CourtLookup, type FetchText } from "./court-locator.js";

export const COURT_TOOL_NAME = "court_for_address";

const TOKEN = /\[(?:LM)?PII:(?:D\d{2}:)?([A-Z_]+):\d{4}(?:\|[A-Z]{2,4})?\]/gu;

const SCHEMA: NormalizedToolSchema = {
  type: "function",
  function: {
    name: COURT_TOOL_NAME,
    description:
      "The common court (district court SR, its regional court SO and appeal court SA, with their seats) for a Polish address, " +
      "decided by the application from the regulation on court areas (t.j. Dz.U. 2026 poz. 492) and GUGiK registers. " +
      "Pass the address exactly as the case gives it, usually its alias ([PII:ADDRESS:0001], [LMPII:D01:ADDRESS:0002]); " +
      "the application restores it locally and never returns it. Choose whose address by the legal basis of jurisdiction " +
      "(defendant's residence or seat, the real estate, the place of performance) and say it in `basis`.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["address", "basis"],
      properties: {
        address: { type: "string", description: "The address or its alias from the case material." },
        basis: { type: "string", description: "Whose address and the provision of jurisdiction, e.g. 'pozwany, art. 27 § 1 KPC'." },
        kind: { type: "string", enum: [...CASE_KINDS], description: "The kind of case (the court's departments differ: gospodarcze, pracy, ksiegi_wieczyste…)." }
      }
    }
  }
};

export type CourtToolEvent = { tool: string; status: CourtLookup["status"]; method?: string; court?: string; disclosed: string[] };

export class CourtToolRuntime {
  private readonly found: CourtLookup[] = [];
  private readonly events: CourtToolEvent[] = [];

  constructor(
    // An alias to the value of the case's vault, or null.
    private readonly resolve: (token: string) => string | null,
    private readonly fetchText: FetchText = defaultFetch
  ) {}

  schemas(): NormalizedToolSchema[] {
    return [SCHEMA];
  }

  handles(name: string): boolean {
    return name === COURT_TOOL_NAME;
  }

  systemPromptAppendix(): string {
    return [
      "# SĄD WŁAŚCIWY (aplikacja)",
      "The court a letter is addressed to, its seat and its address come only from court_for_address or from the case record (SĄD SPRAWY in the material); never from memory or from a city's name alone (Warszawa, Kraków, Łódź, Poznań, Wrocław, Gdańsk, Katowice, Lublin and Szczecin have several district courts).",
      "Material jurisdiction (SR or SO, art. 16-17 KPC, the value of the claim) is yours to decide with its basis; the tool returns both levels for the place.",
      "status FOUND: use the court as returned. NEAR_BOUNDARY or ADDRESS_*: write the court as [Sąd do ustalenia: …] naming the candidates and what is missing (an existing building number); never pick one.",
      "kind.heard false: the district court does not hear that kind of case; the tool lists the courts of the region that do - name it and say the department must be confirmed."
    ].join("\n");
  }

  /** Courts the tool returned in this turn (the letter's addressee is checked against them). */
  courts(): string[] {
    return [...new Set(this.found.flatMap((lookup) => [lookup.sr?.nazwa, lookup.so?.nazwa, lookup.sa?.nazwa, ...(lookup.kind?.alternatives ?? []).map((court) => court.nazwa)]).filter((name): name is string => Boolean(name)))];
  }

  auditEvents(): CourtToolEvent[] {
    return this.events.map((event) => ({ ...event, disclosed: [...event.disclosed] }));
  }

  async runTools(calls: NormalizedToolCall[]): Promise<Array<{ tool_use_id: string; content: string }>> {
    const results: Array<{ tool_use_id: string; content: string }> = [];
    for (const call of calls) {
      const written = typeof call.input.address === "string" ? call.input.address : "";
      const kind = typeof call.input.kind === "string" && (CASE_KINDS as readonly string[]).includes(call.input.kind) ? (call.input.kind as CaseKind) : undefined;
      const disclosed: string[] = [];
      let unknown = false;
      const address = written.replace(TOKEN, (token, tokenKind: string) => {
        const value = this.resolve(token.replace(/\|[A-Z]{2,4}\]$/u, "]"));
        if (value === null) {
          unknown = true;
          return token;
        }
        disclosed.push(tokenKind);
        return value;
      });
      if (unknown || !address.trim()) {
        this.events.push({ tool: COURT_TOOL_NAME, status: "ADDRESS_INCOMPLETE", disclosed: [] });
        results.push({ tool_use_id: call.id, content: JSON.stringify({ status: "ADDRESS_INCOMPLETE", notes: ["Alias adresu nieznany w tej sprawie albo adres pusty: podaj alias adresu strony z materiału sprawy."] }) });
        continue;
      }
      let lookup: CourtLookup;
      try {
        lookup = await locateCourt(address, { fetchText: this.fetchText, ...(kind ? { kind } : {}) });
      } catch (error) {
        lookup = { status: "SERVICE_UNAVAILABLE", basis: "", notes: [error instanceof Error ? error.message : String(error)] };
      }
      this.found.push(lookup);
      this.events.push({
        tool: COURT_TOOL_NAME,
        status: lookup.status,
        ...(lookup.method ? { method: lookup.method } : {}),
        ...(lookup.sr ? { court: lookup.sr.nazwa } : {}),
        disclosed
      });
      // The address and its commune stay in the application: the model gets the courts.
      const { place, ...forModel } = lookup;
      results.push({
        tool_use_id: call.id,
        content: JSON.stringify({ ...forModel, ...(place ? { numerBudynkuWEwidencji: place.exactNumber } : {}), podstawaWlasciwosci: String(call.input.basis ?? "") })
      });
    }
    return results;
  }
}

const defaultFetch: FetchText = async (url, init) => {
  const response = await fetch(url, { signal: init?.signal ?? AbortSignal.timeout(20_000) });
  return { ok: response.ok, status: response.status, text: () => response.text() };
};
