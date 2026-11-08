import fs from "node:fs";
import path from "node:path";
import { isDomainSkill } from "./jurisdiction.js";
// The texts whose phrases decide the executive skill: the SKILL.md of every skill
// outside the DR domains (router, executive skills) and the shared activation matrix.
export function executiveSkillTexts(registry) {
    const texts = [];
    for (const skill of registry.skills.values()) {
        if (isDomainSkill(skill.name))
            continue;
        const files = [skill.skillFile, ...(skill.name === "shared" ? [path.join(skill.directory, "ACTIVATION-MATRIX.md")] : [])];
        for (const file of files) {
            try {
                texts.push(fs.readFileSync(file, "utf8"));
            }
            catch {
                // Unreadable file: its words are not used.
            }
        }
    }
    return texts;
}
