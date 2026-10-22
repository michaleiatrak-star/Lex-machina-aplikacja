import { addMissingVerificationMarkers, FinalizationGate } from "./finalization-gate.js";
// The report and its blueprint pass the finalization gate together. The blueprint is data:
// its schema has plain fields ("przepis": "art. 286 § 1 k.k."), so a provision verified in
// this turn stands there without its marker. The ledger's own marker is added for the gate,
// as in the answer; an unverified provision or amount still blocks.
export function blueprintFinalizationText(answer, blueprint, ledger) {
    const data = JSON.stringify(blueprint);
    return [
        answer,
        "[STRUCTURED_REPORT_BLUEPRINT_DATA]",
        addMissingVerificationMarkers(data, new FinalizationGate().evaluate(data, ledger)),
        "[/STRUCTURED_REPORT_BLUEPRINT_DATA]"
    ].join("\n");
}
