import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
const FRONTMATTER = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/;
export function parseSkillFile(filePath) {
    const raw = fs.readFileSync(filePath, "utf8");
    const match = raw.match(FRONTMATTER);
    if (!match || match[1] === undefined) {
        throw new Error(`Missing YAML frontmatter: ${filePath}`);
    }
    const parsed = YAML.parse(match[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Invalid YAML frontmatter object: ${filePath}`);
    }
    return { frontmatter: parsed, body: raw.slice(match[0].length) };
}
function isDirectory(filePath) {
    try {
        return fs.statSync(filePath).isDirectory();
    }
    catch {
        return false;
    }
}
function isFile(filePath) {
    try {
        return fs.statSync(filePath).isFile();
    }
    catch {
        return false;
    }
}
function assertInside(root, target) {
    const absoluteRoot = path.resolve(root);
    const absoluteTarget = path.resolve(target);
    const relative = path.relative(absoluteRoot, absoluteTarget);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`PATH_ESCAPE: ${target}`);
    }
    return absoluteTarget;
}
export class LexSkillRegistry {
    root;
    skills = new Map();
    constructor(root) {
        this.root = path.resolve(root);
    }
    scan() {
        const issues = [];
        this.skills.clear();
        for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
            if (!entry.isDirectory())
                continue;
            const directory = path.join(this.root, entry.name);
            const skillFile = path.join(directory, "SKILL.md");
            if (!isFile(skillFile))
                continue;
            try {
                const { frontmatter, body } = parseSkillFile(skillFile);
                const name = typeof frontmatter.name === "string"
                    ? frontmatter.name.trim()
                    : "";
                if (!name) {
                    issues.push({
                        code: "MISSING_NAME",
                        target: skillFile,
                        detail: "SKILL.md does not declare a non-empty frontmatter name."
                    });
                    continue;
                }
                if (this.skills.has(name)) {
                    issues.push({
                        code: "DUPLICATE_SKILL_NAME",
                        skill: name,
                        target: skillFile,
                        detail: `Duplicate skill name: ${name}`
                    });
                    continue;
                }
                this.skills.set(name, {
                    name,
                    directory,
                    skillFile,
                    frontmatter,
                    body
                });
            }
            catch (error) {
                issues.push({
                    code: "INVALID_FRONTMATTER",
                    target: skillFile,
                    detail: error instanceof Error ? error.message : String(error)
                });
            }
        }
        return issues;
    }
    get(name) {
        return this.skills.get(name);
    }
    resolveDependency(name) {
        const direct = this.skills.get(name);
        if (direct)
            return direct.directory;
        const candidate = assertInside(this.root, path.join(this.root, name));
        return isDirectory(candidate) ? candidate : null;
    }
    resolveResource(skillName, semanticPath) {
        const normalized = semanticPath.replaceAll("\\", "/").trim();
        if (!normalized)
            return null;
        // "JUR:terminy-procesowe": national law named by key (shared/UNIVERSAL-RUNTIME-ADAPTER.md §1B),
        // resolved through the active jurisdiction's manifest (Polish law: prawo-polskie-v2).
        const key = /^JUR:([a-z0-9-]+)$/u.exec(normalized.replace(/^view\s+/u, ""));
        if (key) {
            const target = this.jurisdictionModules().get(`JUR:${key[1]}`);
            return target ? this.resolveResource(skillName, target) : null;
        }
        let candidate;
        if (normalized.startsWith("shared/") ||
            normalized.startsWith("references/") ||
            normalized.startsWith("modules/") ||
            normalized.startsWith("assets/")) {
            if (normalized.startsWith("shared/")) {
                candidate = path.join(this.root, normalized);
            }
            else {
                const skill = this.skills.get(skillName);
                if (!skill)
                    return null;
                candidate = path.join(skill.directory, normalized);
            }
        }
        else {
            const first = normalized.split("/", 1).at(0);
            if (!first)
                return null;
            if (this.skills.has(first)) {
                candidate = path.join(this.root, normalized);
            }
            else {
                const skill = this.skills.get(skillName);
                if (!skill)
                    return null;
                candidate = path.join(skill.directory, normalized);
            }
        }
        const safe = assertInside(this.root, candidate);
        return isFile(safe) || isDirectory(safe) ? safe : null;
    }
    jurisdictionCache = null;
    /** The active jurisdiction's keys → modules (LEX_JURISDICTION_PACK, default prawo-polskie-v2). */
    jurisdictionModules() {
        if (this.jurisdictionCache?.root === this.root)
            return this.jurisdictionCache.modules;
        const modules = new Map();
        const pack = process.env.LEX_JURISDICTION_PACK?.trim() || "prawo-polskie-v2";
        try {
            const manifest = fs.readFileSync(assertInside(this.root, path.join(this.root, pack, "JURYSDYKCJA.md")), "utf8");
            for (const match of manifest.matchAll(/^\|\s*`(JUR:[a-z0-9-]+)`\s*\|\s*`([^`]+)`\s*\|/gmu))
                modules.set(match[1], match[2]);
        }
        catch {
            // No manifest: a key resolves to nothing (TRYB ZDEGRADOWANY in the skill), never to a guess.
        }
        this.jurisdictionCache = { root: this.root, modules };
        return modules;
    }
    validateDeclarations() {
        const issues = [];
        for (const skill of this.skills.values()) {
            const dependencies = skill.frontmatter.dependencies?.requires ?? [];
            for (const dependency of dependencies) {
                if (!this.resolveDependency(dependency)) {
                    issues.push({
                        code: "MISSING_DEPENDENCY",
                        skill: skill.name,
                        target: dependency,
                        detail: `Declared dependency cannot be resolved: ${dependency}`
                    });
                }
            }
            const resources = skill.frontmatter.required_modules ?? [];
            for (const resource of resources) {
                const semantic = String(resource).split("#", 1).at(0)?.trim() ?? "";
                if (!semantic)
                    continue;
                try {
                    if (!this.resolveResource(skill.name, semantic)) {
                        issues.push({
                            code: "MISSING_REQUIRED_RESOURCE",
                            skill: skill.name,
                            target: semantic,
                            detail: `Declared required resource cannot be resolved: ${semantic}`
                        });
                    }
                }
                catch (error) {
                    issues.push({
                        code: "PATH_ESCAPE",
                        skill: skill.name,
                        target: semantic,
                        detail: error instanceof Error ? error.message : String(error)
                    });
                }
            }
        }
        return issues;
    }
}
