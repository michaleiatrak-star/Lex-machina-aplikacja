import { DETERMINISTIC_ACTION_META_PREFIX, type DeterministicActionId } from "./chat-routing.js";

// Escalation (pisma-proste-v2 -> pisma-procesowe-v3) and reduction (back) offered by the
// runtime (skillSwitch). The thread's skill changes in place: the message sent after the
// switch carries the new action, and the thread restores its action from the last such message.

export type SkillSwitchOffer = {
  from: string;
  to: "pisma-proste-v2" | "pisma-procesowe-v3";
  direction: "ESCALATION" | "REDUCTION";
  reason: string | null;
};

export function switchAction(offer: SkillSwitchOffer): DeterministicActionId {
  return offer.to === "pisma-procesowe-v3" ? "PROCESS_PLEADING" : "SIMPLE_LETTER";
}

export function switchTitle(offer: SkillSwitchOffer): string {
  return offer.direction === "ESCALATION" ? "Sprawa wymaga pisma procesowego" : "Wystarczy pismo proste";
}

export function switchMessage(offer: SkillSwitchOffer): string {
  return offer.direction === "ESCALATION"
    ? "Przełączam na pismo procesowe. Kontynuuj tę sprawę na podstawie tej rozmowy."
    : "Przełączam na pismo proste. Przygotuj to pismo na podstawie tej rozmowy.";
}

/** The message whose meta decides the thread's action: the last one that names an action, else the first. */
export function actionMetaMessage<T extends { role: string; meta?: string }>(messages: readonly T[]): T | undefined {
  const users = messages.filter((message) => message.role === "user");
  return [...users].reverse().find((message) => message.meta?.includes(DETERMINISTIC_ACTION_META_PREFIX)) ?? users[0];
}
