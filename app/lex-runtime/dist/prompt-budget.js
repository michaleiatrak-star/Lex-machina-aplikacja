// How much instruction text a turn sends to the model, by top-level section
// ("# MANDATORY PATH RESOURCE: shared/HIERARCHIA-ZRODEL.md", "# SKILL WYKONAWCZY ..."):
// the measure for moving procedural skill text into the application.
export function promptBudget(systemPrompt, top = 12) {
    const sections = new Map();
    let label = "(wstęp)";
    for (const line of systemPrompt.split("\n")) {
        if (/^# \S/u.test(line))
            label = line.slice(2).trim().slice(0, 90);
        sections.set(label, (sections.get(label) ?? 0) + line.length + 1);
    }
    return {
        chars: systemPrompt.length,
        sections: [...sections.entries()]
            .map(([name, chars]) => ({ label: name, chars }))
            .sort((a, b) => b.chars - a.chars)
            .slice(0, top)
    };
}
export function encodePromptBudget(budget) {
    return `chars=${budget.chars};sections=${budget.sections.map((item) => `${item.label.replace(/[|=;]/g, " ")}=${item.chars}`).join("|")}`;
}
export function decodePromptBudget(detail) {
    const chars = /(?:^|;)chars=(\d+)/.exec(detail)?.[1];
    if (!chars)
        return null;
    const list = /(?:^|;)sections=(.*)$/.exec(detail)?.[1] ?? "";
    return {
        chars: Number(chars),
        sections: list
            .split("|")
            .filter(Boolean)
            .map((item) => {
            const at = item.lastIndexOf("=");
            return { label: item.slice(0, at), chars: Number(item.slice(at + 1)) };
        })
    };
}
