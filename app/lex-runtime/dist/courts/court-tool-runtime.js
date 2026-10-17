import { CASE_KINDS } from "./court-base.js";
import { locateCourt } from "./court-locator.js";
export const COURT_TOOL_NAME = "court_for_address";
const TOKEN = /\[(?:LM)?PII:(?:D\d{2}:)?([A-Z_]+):\d{4}(?:\|[A-Z]{2,4})?\]/gu;
const SCHEMA = {
    type: "function",
    function: {
        name: COURT_TOOL_NAME,
        description: "The common court (district court SR, its regional court SO and appeal court SA, with their seats) for a Polish address, " +
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
export class CourtToolRuntime {
    resolve;
    fetchText;
    found = [];
    events = [];
    constructor(
    // An alias to the value of the case's vault, or null.
    resolve, fetchText = defaultFetch) {
        this.resolve = resolve;
        this.fetchText = fetchText;
    }
    schemas() {
        return [SCHEMA];
    }
    handles(name) {
        return name === COURT_TOOL_NAME;
    }
    systemPromptAppendix() {
        return [
            "# SĄD WŁAŚCIWY (aplikacja)",
            "The court a letter is addressed to, its seat and its address come only from court_for_address or from the case record (SĄD SPRAWY in the material); never from memory or from a city's name alone (Warszawa, Kraków, Łódź, Poznań, Wrocław, Gdańsk, Katowice, Lublin and Szczecin have several district courts).",
            "Material jurisdiction (SR or SO, art. 16-17 KPC, the value of the claim) is yours to decide with its basis; the tool returns both levels for the place.",
            "status FOUND: use the court as returned. NEAR_BOUNDARY or ADDRESS_*: write the court as [Sąd do ustalenia: …] naming the candidates and what is missing (an existing building number); never pick one.",
            "kind.heard false: the district court does not hear that kind of case; the tool lists the courts of the region that do - name it and say the department must be confirmed."
        ].join("\n");
    }
    /** Courts the tool returned in this turn (the letter's addressee is checked against them). */
    courts() {
        return [...new Set(this.found.flatMap((lookup) => [lookup.sr?.nazwa, lookup.so?.nazwa, lookup.sa?.nazwa, ...(lookup.kind?.alternatives ?? []).map((court) => court.nazwa)]).filter((name) => Boolean(name)))];
    }
    auditEvents() {
        return this.events.map((event) => ({ ...event, disclosed: [...event.disclosed] }));
    }
    async runTools(calls) {
        const results = [];
        for (const call of calls) {
            const written = typeof call.input.address === "string" ? call.input.address : "";
            const kind = typeof call.input.kind === "string" && CASE_KINDS.includes(call.input.kind) ? call.input.kind : undefined;
            const disclosed = [];
            let unknown = false;
            const address = written.replace(TOKEN, (token, tokenKind) => {
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
            let lookup;
            try {
                lookup = await locateCourt(address, { fetchText: this.fetchText, ...(kind ? { kind } : {}) });
            }
            catch (error) {
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
const defaultFetch = async (url, init) => {
    const response = await fetch(url, { signal: init?.signal ?? AbortSignal.timeout(20_000) });
    return { ok: response.ok, status: response.status, text: () => response.text() };
};
