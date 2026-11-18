// The step register of a pleading confirmed by the application (point 8): every
// status of the STEP-TRACKER is computed from hard evidence of the turn, not taken from the model's
// own table. ST-FINAL goes under the pleading; any step not confirmed makes it
// "SZKIC — NIEZWERYFIKOWANY" with the list of what is missing.
import { registerGaps } from "./document-register.js";
const ATTACHMENTS = /(?:^|\n)\s*(?:#+\s*|\*\*)?(?:Załączniki|Wykaz\s+załączników)\b/iu;
const CITATION_GATES = {
    LEGAL_CITATIONS: "przepisy",
    CASE_SIGNATURES: "sygnatury orzeczeń",
    DOCUMENT_CITATIONS: "cytaty z dokumentów",
    FINALIZATION: "finalizacja"
};
export function confirmedSteps(evidence) {
    const steps = [];
    const closed = (checkpoint) => evidence.checkpoints?.some((entry) => entry.checkpoint === checkpoint && entry.status === "CLOSED") === true;
    if (evidence.documentsDelivered) {
        const gaps = registerGaps(evidence.register);
        steps.push(!evidence.register.length
            ? { id: "ST-REJESTR", label: "Rejestr dokumentów", status: "OPEN", detail: "rejestr nie powstał (macierz nie była budowana)" }
            : gaps.length
                ? { id: "ST-REJESTR", label: "Rejestr dokumentów", status: "WARN", detail: `nieprzeczytane: ${gaps.map((entry) => entry.id).join(", ")}` }
                : { id: "ST-REJESTR", label: "Rejestr dokumentów", status: "DONE", detail: `${evidence.register.length}/${evidence.register.length} przeczytane` });
        const covered = evidence.register.filter((entry) => entry.state === "READ" || entry.state === "NO_FACTS");
        const facts = evidence.register.reduce((sum, entry) => sum + entry.facts, 0);
        steps.push(!evidence.register.length
            ? { id: "ST-MACIERZ", label: "Macierz faktów — pokrycie", status: "OPEN", detail: "brak macierzy" }
            : covered.length === evidence.register.length && facts > 0
                ? { id: "ST-MACIERZ", label: "Macierz faktów — pokrycie", status: "DONE", detail: `${facts} faktów z ${covered.length} dokumentów` }
                : { id: "ST-MACIERZ", label: "Macierz faktów — pokrycie", status: "WARN", detail: `pokryte ${covered.length}/${evidence.register.length}, faktów ${facts}` });
    }
    const pre = evidence.preW2;
    steps.push(closed("CP-PRE-W2")
        ? { id: "ST-PRE-W2", label: "Walidacja przed W2 (cele, schemat argumentu, fragmenty akt)", status: "DONE", detail: "CP-PRE-W2 zamknięty w ścieżce pisma" }
        : !pre
            ? { id: "ST-PRE-W2", label: "Walidacja przed W2 (cele, schemat argumentu, fragmenty akt)", status: "OPEN", detail: "kontrola nie została wykonana" }
            : pre.schemaLeft.length || pre.gapsLeft.length || pre.requiredMissing
                ? {
                    id: "ST-PRE-W2",
                    label: "Walidacja przed W2 (cele, schemat argumentu, fragmenty akt)",
                    status: "WARN",
                    detail: [
                        ...(pre.schemaLeft.length ? [`schemat: ${pre.schemaLeft.join(", ")}`] : []),
                        ...(pre.gapsLeft.length ? [`siła pisma: ${pre.gapsLeft.join(", ")}`] : []),
                        ...(pre.requiredMissing ? [`niewykorzystane fragmenty akt: ${pre.requiredMissing}`] : [])
                    ].join("; ")
                }
                : { id: "ST-PRE-W2", label: "Walidacja przed W2 (cele, schemat argumentu, fragmenty akt)", status: "DONE", detail: "bez braków po kontroli aplikacji" });
    steps.push(closed("CP-AUDYT")
        ? { id: "ST-HYBRID", label: "HYBRID-VALIDATION (audyt końcowy)", status: "DONE", detail: "CP-AUDYT zamknięty" }
        : { id: "ST-HYBRID", label: "HYBRID-VALIDATION (audyt końcowy)", status: "OPEN", detail: "wykonuje ścieżka pisma (CP-AUDYT) przed plikiem .docx" });
    if (evidence.documentsDelivered) {
        steps.push(ATTACHMENTS.test(evidence.answer)
            ? { id: "ST-ZALACZNIKI", label: "Rejestr załączników", status: "DONE", detail: "pismo ma wykaz załączników" }
            : { id: "ST-ZALACZNIKI", label: "Rejestr załączników", status: "WARN", detail: "pismo nie ma wykazu załączników" });
    }
    const failed = evidence.gates.filter((gate) => gate.id in CITATION_GATES && gate.result !== "PASS");
    steps.push(failed.length
        ? { id: "ST-CYTATY", label: "Bramki cytatów", status: "WARN", detail: `nie przeszły: ${failed.map((gate) => CITATION_GATES[gate.id]).join(", ")}` }
        : { id: "ST-CYTATY", label: "Bramki cytatów", status: "DONE", detail: "przepisy, sygnatury i cytaty z dokumentów potwierdzone" });
    return steps;
}
export function verified(steps) {
    return steps.every((step) => step.status === "DONE");
}
const MARK = { DONE: "✅", WARN: "⚠️", OPEN: "○" };
/** ST-FINAL under the pleading: the verdict, the steps, and the list of what is missing. */
export function stFinal(steps) {
    const open = steps.filter((step) => step.status !== "DONE");
    return [
        `REJESTR KROKÓW (ST-FINAL, potwierdzony przez aplikację): ${open.length ? "SZKIC — NIEZWERYFIKOWANY" : "PISMO ZWERYFIKOWANE"}`,
        "",
        ...steps.map((step) => `- ${MARK[step.status]} ${step.label}: ${step.detail}`),
        ...(open.length ? ["", `Do uzupełnienia przed użyciem pisma: ${open.map((step) => step.label).join("; ")}.`] : [])
    ].join("\n");
}
