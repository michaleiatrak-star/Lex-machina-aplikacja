import fs from "node:fs";
const GATE_HEADING = /HARD GATE|OBOWIĄZ|⛔|BRAMK|-GATE\b|KROK 0\b|ZAWSZE|SEKWENCJ/iu;
const RESOURCE = /(?:shared|references|modules|assets|templates)\/[A-Za-z0-9._\-/]+?\.md\b/g;
const cache = new Map();
export function executiveContract(registry, skill) {
    const record = registry.get(skill);
    if (!record)
        return null;
    let body;
    try {
        body = fs.readFileSync(record.skillFile, "utf8");
    }
    catch {
        return null;
    }
    const key = `${record.skillFile}:${body.length}`;
    if (cache.has(key))
        return cache.get(key);
    const gates = [];
    let current = null;
    const close = () => {
        if (current)
            gates.push({ title: current.title, resources: [...current.resources] });
        current = null;
    };
    let fenced = false;
    for (const line of body.split("\n")) {
        if (/^\s*```/.test(line))
            fenced = !fenced;
        const heading = fenced ? null : /^(#{1,4})\s+(.*)$/.exec(line);
        if (heading) {
            if (current && heading[1].length <= current.level)
                close();
            if (!current && GATE_HEADING.test(heading[2])) {
                current = { title: heading[2].replace(/⛔/gu, "").replace(/\s+/g, " ").trim(), level: heading[1].length, resources: new Set() };
            }
            continue;
        }
        if (current)
            for (const match of line.matchAll(RESOURCE))
                current.resources.add(match[0]);
    }
    close();
    // Frontmatter "dependencies: required: [MOD-...]": shared modules the skill needs every time.
    const dependencies = (record.frontmatter.dependencies ?? {});
    const required = [dependencies.required, dependencies.requires]
        .flatMap((list) => (Array.isArray(list) ? list : []))
        .map((name) => /^(MOD-[A-Z0-9-]+)/u.exec(String(name).trim())?.[1])
        .filter((name) => Boolean(name));
    if (required.length)
        gates.unshift({ title: "dependencies.required (frontmatter SKILL.md)", resources: required.map((name) => `shared/${name}.md`) });
    // Canonical corpus paths ("shared/X.md", "<skill>/references/X.md"), only those
    // that exist (a stale reference is not a contract).
    const canonical = (resource) => (resource.startsWith("shared/") ? resource : `${skill}/${resource}`);
    for (const gate of gates)
        gate.resources = gate.resources.map(canonical);
    const resources = [...new Set(gates.flatMap((gate) => gate.resources))].filter((resource) => registry.resolveResource(skill, resource));
    const contract = {
        skill,
        gates: gates.map((gate) => ({ ...gate, resources: gate.resources.filter((resource) => resources.includes(resource)) })),
        resources
    };
    cache.set(key, contract);
    return contract;
}
// Characters of contract resources the application puts in the context per turn;
// the rest the model reads itself (and the register checks that it did).
export const CONTRACT_BUDGET_CHARS = 120_000;
const MAX_RESOURCE_CHARS = 40_000;
/** Loads the contract resources (plus extra required ones) within the budget. */
export function loadContract(registry, contract, options = {}) {
    const loaded = [];
    const toRead = [];
    let budget = options.budget ?? CONTRACT_BUDGET_CHARS;
    for (const resource of [...new Set([...(options.extra ?? []), ...contract.resources])]) {
        if (options.inContext?.has(resource))
            continue;
        const file = registry.resolveResource(contract.skill, resource);
        let content = "";
        try {
            content = file ? fs.readFileSync(file, "utf8") : "";
        }
        catch {
            content = "";
        }
        if (!content.trim())
            continue;
        if (content.length > MAX_RESOURCE_CHARS || content.length > budget) {
            toRead.push(resource);
            continue;
        }
        budget -= content.length;
        loaded.push({ resource, content });
    }
    return { contract, loaded, toRead };
}
/** What the model is told: the skill's mandatory gates in order and what the app loaded. */
export function contractPrompt(loaded) {
    const { contract } = loaded;
    return [
        `# KONTRAKT SKILLA WYKONAWCZEGO: ${contract.skill} (ustalony przez aplikację z jego SKILL.md)`,
        "Bramki i kroki obowiązkowe skilla, w kolejności z SKILL.md — wykonaj każdy, widocznie, zanim przejdziesz dalej:",
        ...contract.gates.map((gate, index) => `${index + 1}. ${gate.title}`),
        loaded.loaded.length
            ? `Zasoby tych bramek wczytała aplikacja (poniżej, nie otwieraj ich ponownie): ${loaded.loaded.map((item) => item.resource).join(", ")}.`
            : "",
        loaded.toRead.length
            ? `Zasoby zbyt duże do wczytania z góry — wczytaj je sam narzędziem korpusu przed bramką, która ich wymaga (aplikacja to sprawdza): ${loaded.toRead.join(", ")}.`
            : "",
        ...loaded.loaded.map((item) => `## ZASÓB KONTRAKTU: ${contract.skill}/${item.resource}\n\n${item.content}`)
    ]
        .filter(Boolean)
        .join("\n\n");
}
