// Ambiguous questions are classified by the model (user 2026-11-21: "Jaki jest termin na
// apelację?" started the pleading pipeline; opinions next to protocols went to the evidence skill).
// The word patterns stay the first filter; only the ambiguous cases ask the model once, briefly,
// with the list of allowed answers. A local model or any failure keeps the patterns' decision.
import { createHash } from "node:crypto";
// A pleading named, but no drafting verb ("Czy powinienem złożyć apelację?").
const PLEADING_NOUN = /(?<![\p{L}])(?:pozew|pozwu|apelacj\p{L}*|zażaleni\p{L}*|skarg\p{L}*|sprzeciw\p{L}*|odwołani\p{L}*|kasacj\p{L}*|pism\p{L}*\s+(?:procesow|przygotowawcz)\p{L}*|wnios\p{L}*\s+dowodow\p{L}*|odpowied\p{L}*\s+na\s+pozew)(?![\p{L}])/iu;
const DRAFT_VERB = /(?<![\p{L}])(?:napisz|przygotuj|sporządź|zredaguj|opracuj|stwórz|popraw|przeredaguj|dopisz|uzupełnij|napisać|przygotować|sporządzić|zredagować)\p{L}*/iu;
const QUESTION_REACHED_BY_FILES = new Set(["analizator-dowodow-v3", "przesluchanie-swiadkow-v2-min90"]);
export const ROUTE_CHOICES = [
    "pisma-procesowe-v3",
    "pisma-proste-v2",
    "analizator-dowodow-v3",
    "przesluchanie-swiadkow-v2-min90",
    "analiza-sadowa-v6",
    "analizator-umow-v1",
    "analizator-przepisow-v2",
    "orzeczenia-sadowe-v2",
    "chronologia-sprawy-v1",
    "raport-klienta-v1",
    "raport-sytuacyjny-v2"
];
/**
 * Why the patterns' decision is uncertain, or null. Cases (task 05): a pleading named without a
 * drafting verb; the delivered material points to another skill than the words alone; a short
 * question routed to an executive skill though it reads as a question.
 */
export function routeAmbiguity(args) {
    const question = args.question.trim();
    if (!question)
        return null;
    if (PLEADING_NOUN.test(question) && !DRAFT_VERB.test(question) && (args.decided === null || args.decided.startsWith("pisma-"))) {
        return "nazwa pisma bez czasownika redakcyjnego";
    }
    // The words name another executive skill (a fallback such as the guide is no named task).
    if (args.decided && args.wordsOnly && args.decided !== args.wordsOnly && ROUTE_CHOICES.includes(args.wordsOnly))
        return `materiał wskazuje ${args.decided}, słowa ${args.wordsOnly}`;
    // Only the skills a short question reaches by the files alone (a protocol, evidence): a question
    // about a delivered judgment, case law or a contract keeps its skill.
    if (args.decided &&
        QUESTION_REACHED_BY_FILES.has(args.decided) &&
        !args.simpleForm &&
        question.length <= 160 &&
        /\?\s*$/u.test(question) &&
        !DRAFT_VERB.test(question)) {
        return "krótkie pytanie przy skillu wykonawczym";
    }
    return null;
}
const CLASSIFIER_PROMPT = [
    "Jesteś klasyfikatorem próśb do aplikacji prawniczej. Odpowiadasz wyłącznie jednym obiektem JSON, bez komentarza.",
    'Pola: "form": "PROSTA" (pytanie, opinia, krótkie wyjaśnienie — odpowiedź bez procedury skilla) albo "PELNA" (praca: pismo do napisania, analiza akt, dowodów, umowy, pytania do świadka, chronologia, raport);',
    '"skill": przy "PELNA" jedna nazwa z listy dopuszczalnych, przy "PROSTA" null.',
    "Pismo wybierasz tylko, gdy użytkownik prosi o jego napisanie lub poprawienie, nie gdy o nie pyta (termin, treść, sens złożenia).",
    "Dopuszczalne skille: " + ROUTE_CHOICES.join(", ") + "."
].join("\n");
export function parseRouteChoice(text) {
    const json = /\{[\s\S]*\}/u.exec(text)?.[0];
    if (!json)
        return null;
    try {
        const value = JSON.parse(json);
        const form = value.form === "PROSTA" || value.form === "PELNA" ? value.form : null;
        if (!form)
            return null;
        const skill = typeof value.skill === "string" && ROUTE_CHOICES.includes(value.skill) ? value.skill : null;
        if (form === "PELNA" && !skill)
            return null;
        return { form, skill: form === "PELNA" ? skill : null };
    }
    catch {
        return null;
    }
}
const cache = new Map();
const CACHE_MAX = 500;
/** One short call; the answer is kept per question text. Null on any failure. */
export async function classifyRoute(gateway, target, question, materials, timeoutMs = 8_000) {
    const key = createHash("sha256").update(`${question}\u0000${materials.join("|")}`).digest("hex");
    const held = cache.get(key);
    if (held)
        return { choice: held, cached: true, error: null };
    try {
        const response = await gateway.stream(target.provider, {
            model: target.model,
            systemPrompt: CLASSIFIER_PROMPT,
            messages: [
                {
                    role: "user",
                    content: `Prośba użytkownika:\n${question.slice(0, 1_500)}${materials.length ? `\n\nZałączone materiały: ${materials.slice(0, 12).join(", ")}` : ""}`
                }
            ],
            reasoning: "none",
            accountContinuity: "none",
            localMaxOutputTokens: 60,
            abortSignal: AbortSignal.timeout(timeoutMs)
        });
        const choice = parseRouteChoice(response.fullText);
        if (choice) {
            if (cache.size >= CACHE_MAX)
                cache.delete(cache.keys().next().value);
            cache.set(key, choice);
        }
        return { choice, cached: false, error: choice ? null : "ROUTE_CLASSIFIER_UNPARSED" };
    }
    catch (error) {
        return { choice: null, cached: false, error: error instanceof Error ? error.message.slice(0, 120) : "ROUTE_CLASSIFIER_FAILED" };
    }
}
