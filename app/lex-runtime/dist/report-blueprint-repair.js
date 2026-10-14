import fs from "node:fs";
import { markdownSection } from "./skill-sections.js";
// A client or situation report without submit_report_blueprint ended as a technical
// block, although the model had written the report. One repair call turns the model's
// own report into the blueprint: the schema of the skill, the report, only that tool.
const SCHEMA_SOURCES = {
    CLIENT_REPORT_V1: { skill: "raport-klienta-v1", resource: "raport-klienta-v1/references/BLUEPRINT-SCHEMA.md" },
    SITUATION_REPORT_V1: {
        skill: "raport-sytuacyjny-v2",
        resource: "raport-sytuacyjny-v2/SKILL.md",
        sections: [/^## BLUEPRINT JSON/u, /^## WALIDACJA KOMPLETNOŚCI BLUEPRINTU/u]
    }
};
export function blueprintRepairSchema(registry, kind) {
    const source = SCHEMA_SOURCES[kind];
    const file = registry.resolveResource(source.skill, source.resource);
    let body = "";
    try {
        body = file ? fs.readFileSync(file, "utf8") : "";
    }
    catch {
        body = "";
    }
    const text = source.sections ? source.sections.map((heading) => markdownSection(body, heading)).filter(Boolean).join("\n\n") : body;
    return text ? `# SCHEMAT BLUEPRINTU (${source.resource})\n\n${text}` : "";
}
export const BLUEPRINT_REPAIR_REQUEST = [
    "Twoja odpowiedź powyżej nie została zapisana jako raport: brak wywołania submit_report_blueprint.",
    "Wywołaj teraz submit_report_blueprint z danymi z tej odpowiedzi i materiału sprawy, zgodnie ze schematem.",
    "Nie dodawaj faktów, których nie ma w odpowiedzi ani w materiale; nieznane pola zostaw jako null.",
    "Gdy narzędzie zwróci błąd, popraw dane i wywołaj je ponownie. Po przyjęciu odpowiedz jednym zdaniem."
].join("\n");
