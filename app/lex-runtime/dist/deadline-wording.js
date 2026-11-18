// The wording of a provision that decides a deadline, on the date of the event, before the pleading
// adopts the deadline (point 9: art. 88a Pr. adw. gave 7 days in one wording and 14 in
// another). The draft's lines that state a deadline with a provision are checked through
// verify_legal_reference on each event date; a different wording sends the draft back once.
import { citedProvisions } from "./admission-check.js";
const DEADLINE = /(?<![\p{L}])(?:termin\p{L}*|w\s+ciągu|nie\s+później\s+niż)(?![\p{L}])[^.\n]{0,120}?\d+\s*(?:dni|dniowy|tygodni\p{L}*|miesi\p{L}+)/iu;
/** Provisions cited in the draft's sentences that state a deadline, at most `limit`. */
export function deadlineProvisions(answer, limit = 4) {
    const found = [];
    for (const sentence of answer.split(/\n+|(?<=[.;])\s+(?=[\p{Lu}„(])/u)) {
        if (!DEADLINE.test(sentence))
            continue;
        for (const provision of citedProvisions(sentence)) {
            if (found.some((item) => item.claim === provision.claim))
                continue;
            found.push(provision);
            if (found.length >= limit)
                return found;
        }
    }
    return found;
}
export async function deadlineWordings(provisions, dates, runTools) {
    if (!provisions.length || !dates.length)
        return [];
    const calls = [];
    provisions.forEach((provision, index) => {
        calls.push({ provision, asOf: null, call: { id: `deadline-${index + 1}-now`, name: "verify_legal_reference", input: { claim: provision.claim, kind: "statute", act: provision.act } } });
        dates.forEach((asOf, dateIndex) => calls.push({ provision, asOf, call: { id: `deadline-${index + 1}-${dateIndex + 1}`, name: "verify_legal_reference", input: { claim: provision.claim, kind: "statute", act: provision.act, asOf } } }));
    });
    const results = await runTools(calls.map((item) => item.call)).catch(() => []);
    const evidence = (id) => {
        try {
            const payload = JSON.parse(results.find((result) => result.tool_use_id === id)?.content ?? "{}");
            return payload.status === "VERIFIED" && payload.evidence ? payload.evidence : null;
        }
        catch {
            return null;
        }
    };
    const flat = (text) => text.replace(/\s+/gu, " ").trim();
    const wordings = [];
    for (const item of calls.filter((entry) => entry.asOf)) {
        const current = evidence(calls.find((entry) => entry.provision === item.provision && !entry.asOf).call.id);
        const atEvent = evidence(item.call.id);
        wordings.push({
            claim: item.provision.claim,
            asOf: item.asOf,
            result: !current || !atEvent ? "UNKNOWN" : flat(current) === flat(atEvent) ? "SAME" : "DIFFERENT",
            current: (current ?? "").slice(0, 1_500),
            atEvent: (atEvent ?? "").slice(0, 1_500)
        });
    }
    return wordings;
}
export function deadlineCorrection(wordings) {
    const different = wordings.filter((item) => item.result !== "SAME");
    return [
        "KONTROLA APLIKACJI — termin a brzmienie przepisu na dzień zdarzenia. Projekt przyjmuje termin z przepisu, którego brzmienie na dzień zdarzenia jest inne niż dziś albo nie zostało ustalone:",
        ...different.map((item) => item.result === "DIFFERENT"
            ? `- ${item.claim} na ${item.asOf}: „${item.atEvent}”\n  brzmienie dziś: „${item.current}”`
            : `- ${item.claim} na ${item.asOf}: brzmienia nie ustalono w ELI`),
        "Przyjmij termin według brzmienia z dnia zdarzenia (chyba że przepisy przejściowe nowelizacji stanowią inaczej — wtedy wskaż je), napisz w piśmie, z którego brzmienia wynika termin, a gdy brzmienia nie ustalono, przedstaw oba warianty terminu i zachowaj krótszy. Oddaj cały projekt."
    ].join("\n");
}
