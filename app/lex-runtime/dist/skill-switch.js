import { waitsForUser } from "./workflow-wait.js";
const ESCALATION = /ESKALACJA\s+DO\s+[`*_]*pisma-procesowe-v3/iu;
const LETTER = /TREŚĆ\s+PISMA/iu;
const REDUCTION_NAMED = /REDUKCJA\s+DO\s+[`*_]*pisma-proste-v2/iu;
const PROPOSES_SIMPLE = /pisma-proste-v2/u;
const QUESTION = /\?\s*(?:[*_`)\]]\s*)*$/mu;
const PROPOSAL = /propon\p{L}*|wystarcz\p{L}*|kwalifikuje\s+si\p{L}*|Test\s+B|przełącz\p{L}*/iu;
function reasonOf(text) {
    const line = /^[ \t>*_-]*Przyczyna\s*:\s*(.+)$/imu.exec(text)?.[1]?.replace(/[*_`]+/g, "").trim();
    return line ? line.slice(0, 300) : null;
}
const PROPOSES_PLEADING = /pisma-procesowe-v3/u;
// The message with its reason and without a letter: a mention in the notes to a finished
// letter ("ESKALACJA DO pisma-procesowe-v3 nie jest wymagana") is not an escalation. In lay
// words ("Czy przełączyć na pisma-procesowe-v3?", live C12-027) the question is the offer too.
export function escalationOffer(text) {
    if (LETTER.test(text))
        return null;
    const reason = reasonOf(text);
    if (ESCALATION.test(text) && reason)
        return { from: "pisma-proste-v2", to: "pisma-procesowe-v3", direction: "ESCALATION", reason };
    const asked = PROPOSES_PLEADING.test(text) &&
        /przełącz\p{L}*\s+(?:wątek\s+)?na\s+[`*_]*pisma-procesowe-v3[^\n?]*\?/iu.test(text);
    return asked ? { from: "pisma-proste-v2", to: "pisma-procesowe-v3", direction: "ESCALATION", reason } : null;
}
/** Test B: the pleading answer proposes the simple-letter skill and asks the user. */
export function reductionOffer(text) {
    const named = REDUCTION_NAMED.test(text);
    const proposed = PROPOSES_SIMPLE.test(text) && PROPOSAL.test(text) && (waitsForUser(text) || QUESTION.test(text));
    return named || proposed
        ? { from: "pisma-procesowe-v3", to: "pisma-proste-v2", direction: "REDUCTION", reason: reasonOf(text) }
        : null;
}
