import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { activeCountry, activeJurisdictionPack, registerJurisdictionCorpus, skillOfferedInJurisdiction } from "./jurisdiction.js";

export type SkillFrontmatter = {
  name?: string;
  version?: string;
  type?: string;
  status?: string;
  entrypoint?: string;
  compatibility?: string;
  description?: string;
  dependencies?: {
    requires?: string[];
    called_by?: string[];
  };
  required_modules?: string[];
  [key: string]: unknown;
};

export type LexSkillRecord = {
  name: string;
  directory: string;
  skillFile: string;
  frontmatter: SkillFrontmatter;
  body: string;
};

export type ValidationIssue = {
  code:
    | "INVALID_FRONTMATTER"
    | "MISSING_NAME"
    | "DUPLICATE_SKILL_NAME"
    | "MISSING_DEPENDENCY"
    | "MISSING_REQUIRED_RESOURCE"
    | "PATH_ESCAPE";
  skill?: string;
  target?: string;
  detail: string;
};

const FRONTMATTER = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/;

export function parseSkillFile(filePath: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const raw = fs.readFileSync(filePath, "utf8");
  const match = raw.match(FRONTMATTER);
  if (!match || match[1] === undefined) {
    throw new Error(`Missing YAML frontmatter: ${filePath}`);
  }
  const parsed = YAML.parse(match[1]) as SkillFrontmatter | null;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid YAML frontmatter object: ${filePath}`);
  }
  return { frontmatter: parsed, body: raw.slice(match[0].length) };
}

function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function assertInside(root: string, target: string): string {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(target);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`PATH_ESCAPE: ${target}`);
  }
  return absoluteTarget;
}

export class LexSkillRegistry {
  readonly root: string;
  // Every skill of the corpus; `skills` is what the chosen legal system offers (jurisdiction.ts).
  private readonly allSkills = new Map<string, LexSkillRecord>();
  // Jurisdiction packages (a JURYSDYKCJA.md beside SKILL.md: prawo-polskie-v2, later prawo-<kraj>).
  private readonly facades = new Set<string>();
  private offeredCache: { key: string; skills: Map<string, LexSkillRecord> } | null = null;
  private scans = 0;

  /** Every skill of the corpus, whatever the chosen legal system (skill updates replace the whole corpus). */
  get everySkill(): ReadonlyMap<string, LexSkillRecord> {
    return this.allSkills;
  }

  /** The skills the chosen legal system offers: another country's package and domain skills are left out. */
  get skills(): Map<string, LexSkillRecord> {
    const key = `${this.scans}|${activeJurisdictionPack()}|${activeCountry()}`;
    if (this.offeredCache?.key === key) return this.offeredCache.skills;
    const offered = new Map([...this.allSkills].filter(([name]) => skillOfferedInJurisdiction(name, this.facades, this.root)));
    this.offeredCache = { key, skills: offered };
    return offered;
  }

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  scan(): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    this.allSkills.clear();
    this.facades.clear();
    this.scans += 1;
    registerJurisdictionCorpus(this.root);

    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(this.root, entry.name);
      const skillFile = path.join(directory, "SKILL.md");
      if (!isFile(skillFile)) continue;

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

        if (this.allSkills.has(name)) {
          issues.push({
            code: "DUPLICATE_SKILL_NAME",
            skill: name,
            target: skillFile,
            detail: `Duplicate skill name: ${name}`
          });
          continue;
        }

        if (isFile(path.join(directory, "JURYSDYKCJA.md"))) this.facades.add(name);
        this.allSkills.set(name, {
          name,
          directory,
          skillFile,
          frontmatter,
          body
        });
      } catch (error) {
        issues.push({
          code: "INVALID_FRONTMATTER",
          target: skillFile,
          detail: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return issues;
  }

  get(name: string): LexSkillRecord | undefined {
    return this.skills.get(name);
  }

  resolveDependency(name: string): string | null {
    const direct = this.skills.get(name);
    if (direct) return direct.directory;

    const candidate = assertInside(this.root, path.join(this.root, name));
    return isDirectory(candidate) ? candidate : null;
  }

  resolveResource(skillName: string, semanticPath: string): string | null {
    const normalized = semanticPath.replaceAll("\\", "/").trim();
    if (!normalized) return null;
    // "JUR:terminy-procesowe": national law named by key (shared/UNIVERSAL-RUNTIME-ADAPTER.md §1B),
    // resolved through the active jurisdiction's manifest (Polish law: prawo-polskie-v2).
    const key = /^JUR:([a-z0-9-]+)$/u.exec(normalized.replace(/^view\s+/u, ""));
    if (key) {
      const target = this.jurisdictionModules().get(`JUR:${key[1]}`);
      return target ? this.resolveResource(skillName, target) : null;
    }

    let candidate: string;

    if (
      normalized.startsWith("shared/") ||
      normalized.startsWith("references/") ||
      normalized.startsWith("modules/") ||
      normalized.startsWith("assets/")
    ) {
      if (normalized.startsWith("shared/")) {
        candidate = path.join(this.root, normalized);
      } else {
        const skill = this.skills.get(skillName);
        if (!skill) return null;
        candidate = path.join(skill.directory, normalized);
      }
    } else {
      const first = normalized.split("/", 1).at(0);
      if (!first) return null;
      if (this.skills.has(first)) {
        candidate = path.join(this.root, normalized);
      } else {
        const skill = this.skills.get(skillName);
        if (!skill) return null;
        candidate = path.join(skill.directory, normalized);
      }
    }

    const safe = assertInside(this.root, candidate);
    return isFile(safe) || isDirectory(safe) ? safe : null;
  }

  private jurisdictionCache: { root: string; pack: string; modules: Map<string, string> } | null = null;

  /** The active jurisdiction's keys → modules (jurisdiction.ts: Settings or LEX_JURISDICTION_PACK, default prawo-polskie-v2). */
  jurisdictionModules(): Map<string, string> {
    const pack = activeJurisdictionPack();
    if (this.jurisdictionCache?.root === this.root && this.jurisdictionCache.pack === pack) return this.jurisdictionCache.modules;
    const modules = new Map<string, string>();
    try {
      const manifest = fs.readFileSync(assertInside(this.root, path.join(this.root, pack, "JURYSDYKCJA.md")), "utf8");
      for (const match of manifest.matchAll(/^\|\s*`(JUR:[a-z0-9-]+)`\s*\|\s*`([^`]+)`\s*\|/gmu)) modules.set(match[1]!, match[2]!);
    } catch {
      // No manifest: a key resolves to nothing (TRYB ZDEGRADOWANY in the skill), never to a guess.
    }
    this.jurisdictionCache = { root: this.root, pack, modules };
    return modules;
  }

  validateDeclarations(): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

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
        if (!semantic) continue;
        try {
          if (!this.resolveResource(skill.name, semantic)) {
            issues.push({
              code: "MISSING_REQUIRED_RESOURCE",
              skill: skill.name,
              target: semantic,
              detail: `Declared required resource cannot be resolved: ${semantic}`
            });
          }
        } catch (error) {
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
