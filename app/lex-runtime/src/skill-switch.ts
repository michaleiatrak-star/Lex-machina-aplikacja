import { waitsForUser } from "./workflow-wait.js";

// Escalation and reduction between the two letter skills, as their own texts define them:
// pisma-proste-v2 M7-eskalacja (fixed message "ESKALACJA DO pisma-procesowe-v3 / Przyczyna: ...")
// and pisma-procesowe-v3 KROK 0 Test B ("zaproponuj pisma-proste-v2 i zapytaj użytkownika").
// A thread pinned to one skill cannot load the other one's pipeline: the answer is presented
// as the offer and the chat switches the thread's skill when the user accepts.

export type SkillSwitchOffer = {
  from: "pisma-proste-v2" | "pisma-procesowe-v3";
  to: "pisma-proste-v2" | "pisma-procesowe-v3";
  direction: "ESCALATION" | "REDUCTION";
  reason: string | null;
};

const ESCALATION = /ESKALACJA\s+DO\s+[`*_]*pisma-procesowe-v3/iu;
const LETTER = /TREŚĆ\s+PISMA/iu;
const REDUCTION_NAMED = /REDUKCJA\s+DO\s+[`*_]*pisma-proste-v2/iu;
const PROPOSES_SIMPLE = /pisma-proste-v2/u;
const QUESTION = /\?\s*(?:[*_`)\]]\s*)*$/mu;
const PROPOSAL = /propon\p{L}*|wystarcz\p{L}*|kwalifikuje\s+si\p{L}*|Test\s+B|przełącz\p{L}*/iu;

function reasonOf(text: string): string | null {
  const line = /^[ \t>*_-]*Przyczyna\s*:\s*(.+)$/imu.exec(text)?.[1]?.replace(/[*_`]+/g, "").trim();
  return line ? line.slice(0, 300) : null;
}

// The message with its reason and without a letter: a mention in the notes to a finished
// letter ("ESKALACJA DO pisma-procesowe-v3 nie jest wymagana") is not an escalation.
export function escalationOffer(text: string): SkillSwitchOffer | null {
  const reason = reasonOf(text);
  return ESCALATION.test(text) && reason && !LETTER.test(text)
    ? { from: "pisma-proste-v2", to: "pisma-procesowe-v3", direction: "ESCALATION", reason }
    : null;
}

/** Test B: the pleading answer proposes the simple-letter skill and asks the user. */
export function reductionOffer(text: string): SkillSwitchOffer | null {
  const named = REDUCTION_NAMED.test(text);
  const proposed =
    PROPOSES_SIMPLE.test(text) && PROPOSAL.test(text) && (waitsForUser(text) || QUESTION.test(text));
  return named || proposed
    ? { from: "pisma-procesowe-v3", to: "pisma-proste-v2", direction: "REDUCTION", reason: reasonOf(text) }
    : null;
}
