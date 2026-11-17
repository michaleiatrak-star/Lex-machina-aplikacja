// The instructions fit the model's window (user report 2026-11-17: ~144-158k tokens of skill text went
// to a model with a 128k-token window; the provider cut it at random and the documents were left out
// entirely). The sections the application wrote for this turn always stay; the executing skill's core
// stays while it can; every other skill section gives way first, the largest first, leaving a stub that
// points the model to read_legal_resource when it needs that text.
// Written by the application for this turn: facts, goals, matrix, parties, path, checkpoint, policies.
const APPLICATION = /(?:aplikacj|ustalon|wskazan\p{L}* przez|LOCAL DOCUMENT|PERSON|PLACEHOLDER|KROK CZEKAJĄCY|CHECKPOINT|STAN (?:PROCESU|ETAPU)|ŚCIEŻKA OBOWIĄZKOWA|KONTRAKT SKILLA|SKILL WYKONAWCZY|LOCAL LEGAL CORPUS|DOKUMENTY SPRAWY|PYTANIE|SĄD WŁAŚCIWY)/iu;
// The executing skill's core and the gates every legal answer goes through.
const CORE = /(?:Pisma Procesowe v3|Router Prawny v3|PRAWO-HARDGATE|AUTOMAT-STANOW|BUDOWA-ARGUMENTU|MOD-FAKTY|MOD-CP-GATE|MOD-CN-GATE|MOD-WYJATEK-GATE|MOD-REM-GATE|MOD-OS-CZASU|KROK 1\b|DISCLAIMER|SKILLE PRAWNE W UŻYCIU)/iu;
function stageOf(label, scope) {
    if (!scope)
        return undefined;
    for (const [stem, checkpoint] of scope.owner)
        if (label.includes(stem))
            return checkpoint;
    return undefined;
}
function sections(prompt, scope) {
    const parts = prompt.split(/\n(?=# \S)/u);
    return parts.map((text, index) => {
        const label = index === 0 && !/^# \S/u.test(text) ? "(wstęp)" : text.slice(2, text.indexOf("\n") < 0 ? undefined : text.indexOf("\n")).trim().slice(0, 120);
        const stage = stageOf(label, scope);
        const tier = index === 0 || APPLICATION.test(label) || (stage !== undefined && stage === scope?.current) ? 0 : CORE.test(label) ? 1 : 2;
        return { label, text, tier, ...(stage ? { stage } : {}) };
    });
}
const stub = (label, chars) => `# ${label}\n[Pominięte w tej turze (${chars} znaków): instrukcje nie mieszczą się w oknie modelu. Gdy ta treść jest potrzebna do kroku, odczytaj ją narzędziem read_legal_resource; nie zakładaj jej brzmienia.]`;
/**
 * The share of the usable window the instructions may take: the documents and the conversation get
 * the rest. Unknown window: the prompt goes as it is.
 */
export function fitInstructions(prompt, windowTokens, charsPerToken = 3, share = 0.6, scope) {
    const unchanged = { text: prompt, trimmed: false, originalChars: prompt.length, dropped: [], shortened: [] };
    if (!windowTokens)
        return unchanged;
    const outputReserve = Math.min(16_384, Math.max(4_096, Math.floor(windowTokens * 0.12)));
    const safety = Math.max(2_048, Math.floor(windowTokens * 0.04));
    const budget = Math.floor((windowTokens - outputReserve - safety) * charsPerToken * share);
    if (prompt.length <= budget)
        return unchanged;
    const list = sections(prompt, scope);
    let size = prompt.length;
    const dropped = [];
    const shortened = [];
    // The modules of other checkpoints first (they are read whole in their own turns), then other skill
    // text, the largest first; then the core, shortened to its opening part.
    for (const tier of [2, 1]) {
        const order = list
            .map((section, index) => ({ section, index }))
            .filter((item) => item.section.tier === tier)
            .sort((a, b) => Number(Boolean(b.section.stage)) - Number(Boolean(a.section.stage)) || b.section.text.length - a.section.text.length);
        for (const { section } of order) {
            if (size <= budget)
                break;
            if (tier === 2) {
                const replacement = section.stage
                    ? `# ${section.label}\n[Moduł etapu ${section.stage}: w tej turze odłożony (okno modelu), wczytywany w całości w turze swojego etapu.]`
                    : stub(section.label, section.text.length);
                if (replacement.length >= section.text.length)
                    continue;
                size -= section.text.length - replacement.length;
                section.text = replacement;
                dropped.push(section.label);
            }
            else {
                const keep = Math.max(2_000, Math.floor(section.text.length / 3));
                if (keep >= section.text.length)
                    continue;
                const cut = section.text.lastIndexOf("\n", keep);
                const head = section.text.slice(0, cut > keep / 2 ? cut : keep);
                const replacement = `${head}\n[… dalsza część (${section.text.length - head.length} znaków) pominięta: okno modelu; odczytaj ją narzędziem read_legal_resource, gdy jest potrzebna.]`;
                size -= section.text.length - replacement.length;
                section.text = replacement;
                shortened.push(section.label);
            }
        }
    }
    return { text: list.map((section) => section.text).join("\n"), trimmed: true, originalChars: prompt.length, dropped, shortened };
}
