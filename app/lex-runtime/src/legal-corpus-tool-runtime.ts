import { suggestDomainModules } from "./domain-module-map.js";
import fs from "node:fs";
import path from "node:path";
import type {
  NormalizedToolCall,
  NormalizedToolResult,
  NormalizedToolSchema
} from "./providers/types.js";
import {
  LexSkillRegistry
} from "./registry.js";
import {
  CRIMINAL_DOMAIN_PREFIX,
  CRIMINAL_QUALIFIER_INDEX
} from "./execution-engine.js";

const ROUTER_SKILL = "prawny-router-v3";
// Loaded by the router itself; they are not a legal domain or workflow.
const INFRASTRUCTURE_SKILLS = new Set([
  ROUTER_SKILL,
  "shared",
  "prawo-polskie-v2"
]);

export type ModelSkillSelection = {
  primarySkill: string | null;
  loadedSkills: string[];
  domainSkills: string[];
  executionSkills: string[];
};

const LIST_SKILLS =
  "list_legal_skills";
const LIST_RESOURCES =
  "list_legal_resources";
const READ_RESOURCE =
  "read_legal_resource";

const MAX_READ_CHARS = 40_000;
const MAX_TEXT_FILE_BYTES =
  16 * 1024 * 1024;
const RESOURCE_PAGE_SIZE = 200;

export type LegalCorpusAuditEvent = {
  tool: string;
  target: string;
  decision:
    "ALLOW" | "BLOCK";
  detail?:
    Record<string, unknown>;
};

const SKILL_SCHEMA:
  NormalizedToolSchema = {
    type: "function",
    function: {
      name: LIST_SKILLS,
      description:
        "List legal skills available in the local Lex Machina corpus. " +
        "Use this when a SKILL.md tells you to activate another skill and you need the exact canonical name.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {}
      }
    }
  };

const RESOURCE_LIST_SCHEMA:
  NormalizedToolSchema = {
    type: "function",
    function: {
      name: LIST_RESOURCES,
      description:
        "List text resources available under one local legal skill. " +
        "Use this when the skill references modules/, references/, shared/ or another resource but the exact filename is unknown.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["skill"],
        properties: {
          skill: {
            type: "string",
            description:
              "Exact legal skill name, e.g. dr-02-prawo-cywilne-rodzinne-gospodarcze or shared."
          },
          prefix: {
            type: "string",
            description:
              "Optional relative path prefix, e.g. modules/ or references/."
          },
          cursor: {
            type: "integer",
            minimum: 0,
            description:
              "Optional pagination cursor returned by a prior call."
          }
        }
      }
    }
  };

const RESOURCE_READ_SCHEMA:
  NormalizedToolSchema = {
    type: "function",
    function: {
      name: READ_RESOURCE,
      description:
        "Read a local legal corpus resource. " +
        "Use this whenever a loaded SKILL.md says view <path>. " +
        "The path is resolved only inside the Lex legal corpus; arbitrary filesystem paths are forbidden. " +
        "Large resources are paginated by character offset.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: [
          "skill",
          "path"
        ],
        properties: {
          skill: {
            type: "string",
            description:
              "Skill providing the relative context for the resource."
          },
          path: {
            type: "string",
            description:
              "Semantic path, e.g. modules/mod-KC.md, references/CHECKLIST.md, shared/PRAWO-HARDGATE.md or another-skill/SKILL.md."
          },
          offset: {
            type: "integer",
            minimum: 0,
            description:
              "Character offset for paginating a large text resource."
          },
          maxChars: {
            type: "integer",
            minimum: 1,
            maximum:
              MAX_READ_CHARS,
            description:
              "Maximum characters returned in this call."
          }
        }
      }
    }
  };

function normalizePrefix(
  value: unknown
): string {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return "";
  }
  if (
    typeof value !== "string"
  ) {
    throw new Error(
      "INVALID_RESOURCE_PREFIX"
    );
  }
  const normalized =
    value
      .replaceAll("\\", "/")
      .replace(/^\.\//, "")
      .trim();
  if (
    normalized.startsWith("/") ||
    normalized
      .split("/")
      .some(
        (segment) =>
          segment === ".."
      )
  ) {
    throw new Error(
      "INVALID_RESOURCE_PREFIX"
    );
  }
  return normalized;
}

// Loose matching of a mistyped skill name or resource path: the model gets
// the file in the same round when exactly one matches (like a native reader
// recovering with Glob, but without the extra round), otherwise the list of
// candidates instead of a bare LEGAL_RESOURCE_NOT_FOUND.
const MAX_RESOURCE_CANDIDATES = 12;

function looseKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "l")
    .toLowerCase()
    .replace(/\.(md|markdown|txt|ya?ml|json)$/, "")
    .replace(/[\s_.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// "-v3", "-v2.1": a wrong version number in a name is the commonest slip.
function withoutVersion(key: string): string {
  return key.replace(/-v\d+(?:-\d+)*(?=-|$)/g, "");
}

function looseSkill(registry: LexSkillRegistry, requested: string): string[] {
  const key = looseKey(requested);
  if (!key) return [];
  const names = [...registry.skills.values()].map((skill) => ({
    name: skill.name,
    keys: [looseKey(skill.name), looseKey(path.basename(skill.directory))]
  }));
  const exact = names.filter((item) => item.keys.includes(key));
  if (exact.length) return exact.map((item) => item.name);
  const unversioned = names.filter((item) =>
    item.keys.some((name) => withoutVersion(name) === withoutVersion(key))
  );
  if (unversioned.length) return unversioned.map((item) => item.name);
  return names
    .filter((item) => item.keys.some((name) => name.startsWith(`${key}-`) || key.startsWith(`${name}-`)))
    .map((item) => item.name);
}

export function looseResource(
  registry: LexSkillRegistry,
  skillName: string,
  requested: string
): { match: string | null; matchSkill?: string; candidates: string[] } {
  const own = looseResourceIn(registry, skillName, requested);
  if (own.match || own.candidates.length) return own;
  // Not in this skill at all: the same file name in another skill or shared/
  // (a module cited from a different domain), only on an exact name match.
  const wanted = looseKey(path.posix.basename(requested.replaceAll("\\", "/")));
  if (!wanted) return own;
  const hits = [...registry.skills.values()].flatMap((skill) =>
    skill.name === skillName || !fs.existsSync(skill.directory)
      ? []
      : collectFiles(skill.directory, "")
          .filter((file) => withoutVersion(looseKey(path.posix.basename(file))) === withoutVersion(wanted))
          .map((file) => ({ skill: skill.name, file }))
  );
  const hit = hits[0];
  return hits.length === 1 && hit
    ? { match: hit.file, matchSkill: hit.skill, candidates: [`${hit.skill}/${hit.file}`] }
    : { match: null, candidates: hits.slice(0, MAX_RESOURCE_CANDIDATES).map((item) => `${item.skill}/${item.file}`) };
}

function looseResourceIn(
  registry: LexSkillRegistry,
  skillName: string,
  requested: string
): { match: string | null; candidates: string[] } {
  const skill = registry.get(skillName);
  if (!skill) return { match: null, candidates: [] };
  const normalized = requested.replaceAll("\\", "/").replace(/^\.\//, "").trim();
  const shared = normalized.startsWith("shared/");
  const base = shared ? path.join(registry.root, "shared") : skill.directory;
  if (!fs.existsSync(base)) return { match: null, candidates: [] };
  const files = shared
    ? collectFiles(base, "").map((file) => `shared/${file}`)
    : collectFiles(base, "");
  const wanted = looseKey(path.posix.basename(normalized));
  const wantedDir = looseKey(path.posix.dirname(normalized));
  if (!wanted) return { match: null, candidates: [] };
  const scored = files
    .map((file) => {
      const base = looseKey(path.posix.basename(file));
      const dir = looseKey(path.posix.dirname(file));
      let score = 0;
      if (base === wanted) score = 100;
      else if (withoutVersion(base) === withoutVersion(wanted)) score = 90;
      else if (wanted.length >= 6 && base.startsWith(withoutVersion(wanted))) score = 60;
      else if (wanted.length >= 6 && (base.includes(wanted) || wanted.startsWith(base))) score = 40;
      else {
        const tokens = wanted.split("-").filter((token) => token.length >= 3);
        const hits = tokens.filter((token) => base.includes(token)).length;
        if (tokens.length && hits / tokens.length >= 0.6) score = Math.round(30 * hits / tokens.length);
      }
      if (score && wantedDir && wantedDir !== "." && dir === wantedDir) score += 5;
      return { file, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file, "pl"));
  const best = scored[0];
  const unique =
    best !== undefined &&
    best.score >= 60 &&
    (scored.length === 1 || scored[1]!.score < best.score);
  return {
    match: unique ? best.file : null,
    candidates: scored.slice(0, MAX_RESOURCE_CANDIDATES).map((item) => item.file)
  };
}

function textFile(
  filePath: string
): string {
  const stat =
    fs.statSync(filePath);
  if (
    !stat.isFile() ||
    stat.size >
      MAX_TEXT_FILE_BYTES
  ) {
    throw new Error(
      "LEGAL_RESOURCE_NOT_TEXT"
    );
  }
  const data =
    fs.readFileSync(filePath);
  if (
    data.includes(0)
  ) {
    throw new Error(
      "LEGAL_RESOURCE_NOT_TEXT"
    );
  }
  return data.toString(
    "utf8"
  );
}

function collectFiles(
  root: string,
  prefix: string
): string[] {
  const result:
    string[] = [];

  function walk(
    directory: string
  ): void {
    for (
      const entry
      of fs.readdirSync(
        directory,
        {
          withFileTypes: true
        }
      )
    ) {
      if (
        entry.name ===
          ".git" ||
        entry.name ===
          "node_modules"
      ) {
        continue;
      }
      const target =
        path.join(
          directory,
          entry.name
        );
      if (
        entry.isDirectory()
      ) {
        walk(target);
      } else if (
        entry.isFile()
      ) {
        const relative =
          path.relative(
            root,
            target
          )
          .replaceAll(
            path.sep,
            "/"
          );
        if (
          !prefix ||
          relative.startsWith(
            prefix
          )
        ) {
          result.push(
            relative
          );
        }
      }
    }
  }

  walk(root);
  return result.sort(
    (a, b) =>
      a.localeCompare(
        b,
        "pl"
      )
  );
}

export class LegalCorpusToolRuntime {
  private readonly events:
    LegalCorpusAuditEvent[] = [];

  // Skills whose SKILL.md the model read, in order.
  private readonly readSkills:
    string[] = [];
  // SKILL.md coverage: characters read of the whole file (a truncated first
  // part is not a read skill; the gates and pipeline often sit at the end).
  private readonly skillCoverage = new Map<string, { total: number; ranges: Array<[number, number]>; how: "tool" | "preloaded" | "native" }>();

  private cover(skill: string, total: number, from: number, to: number, how: "tool" | "preloaded" | "native"): void {
    const entry = this.skillCoverage.get(skill) ?? { total, ranges: [], how };
    entry.total = total;
    entry.ranges.push([from, to]);
    if (how !== "tool") entry.how = how;
    this.skillCoverage.set(skill, entry);
  }

  /** Per read skill: characters read, total, complete. */
  skillReads(): Array<{ skill: string; read: number; total: number; complete: boolean; how: "tool" | "preloaded" | "native" }> {
    return this.readSkills.map((skill) => {
      const entry = this.skillCoverage.get(skill);
      if (!entry || entry.how !== "tool") return { skill, read: entry?.total ?? 0, total: entry?.total ?? 0, complete: true, how: entry?.how ?? "preloaded" };
      const ranges = [...entry.ranges].sort((a, b) => a[0] - b[0]);
      let read = 0;
      let end = 0;
      for (const [from, to] of ranges) {
        if (to <= end) continue;
        read += to - Math.max(from, end);
        end = to;
      }
      return { skill, read, total: entry.total, complete: read >= entry.total, how: "tool" };
    });
  }
  private qualifierDelivered = false;

  constructor(
    private readonly registry:
      LexSkillRegistry,
    // AUTO for account/API models: the model picks skills itself; the runtime
    // still enforces router-v3 first and the criminal qualifier.
    private readonly options: {
      modelSelectsSkills?: boolean;
    } = {}
  ) {}

  private caseText = "";
  // Resources the application already put in the model's context this turn.
  private inContext: ReadonlySet<string> = new Set();

  /** The live set of resources the application loaded into the prompt: a read of one returns no second copy. */
  setInContext(resources: ReadonlySet<string>): void {
    this.inContext = resources;
  }

  /** The question and the document kinds: what the domain's act map is matched against. */
  setCaseText(text: string): void {
    this.caseText = text;
  }

  modelSkillSelection(): ModelSkillSelection {
    const domainSkills =
      this.readSkills.filter((name) => name.startsWith("dr-"));
    const executionSkills =
      this.readSkills.filter(
        (name) =>
          !name.startsWith("dr-") &&
          !INFRASTRUCTURE_SKILLS.has(name)
      );
    return {
      primarySkill:
        domainSkills[0] ??
        (this.readSkills.length > 0 ? ROUTER_SKILL : null),
      loadedSkills: [...this.readSkills],
      domainSkills,
      executionSkills
    };
  }

  /** A corpus file the model read with its own read-only file tool (native corpus access). */
  recordNativeRead(relativePath: string): void {
    const skill = this.skillForPath(relativePath);
    const parts = relativePath.split("/");
    if (skill && parts.length === 2 && parts[1] === "SKILL.md" && !this.readSkills.includes(skill)) {
      this.readSkills.push(skill);
    }
    // The host's own Read returns the file (line-limited); its coverage is not visible here.
    if (skill && parts.length === 2 && parts[1] === "SKILL.md") this.cover(skill, 0, 0, 0, "native");
    if (skill?.startsWith(CRIMINAL_DOMAIN_PREFIX) && relativePath.endsWith(`/${CRIMINAL_QUALIFIER_INDEX}`)) {
      this.qualifierDelivered = true;
    }
    this.events.push({ tool: "Read", target: relativePath, decision: "ALLOW", detail: { native: true } });
  }

  /** A native Read of a corpus file that does not exist: correctable, not a read. */
  recordNativeMissing(relativePath: string): void {
    this.events.push({
      tool: "Read",
      target: relativePath,
      decision: "BLOCK",
      detail: { native: true, error: "LEGAL_RESOURCE_NOT_FOUND" }
    });
  }

  /** A SKILL.md the runtime put in the prompt up front (router v3, prawo-polskie-v2). */
  recordPreloaded(relativePath: string): void {
    const skill = this.skillForPath(relativePath);
    if (skill && relativePath.split("/").length === 2 && relativePath.endsWith("/SKILL.md") && !this.readSkills.includes(skill)) {
      this.readSkills.push(skill);
    }
    if (skill && relativePath.split("/").length === 2 && relativePath.endsWith("/SKILL.md")) this.cover(skill, 0, 0, 0, "preloaded");
    this.events.push({ tool: READ_RESOURCE, target: relativePath, decision: "ALLOW", detail: { preloaded: true } });
  }

  /**
   * A criminal-law skill was read natively without the qualifier: the
   * corpus path the model still has to read before qualifying the act.
   */
  missingCriminalQualifier(): string | null {
    if (this.qualifierDelivered) return null;
    const criminal = this.readSkills.find((name) => name.startsWith(CRIMINAL_DOMAIN_PREFIX));
    const skill = criminal ? this.registry.get(criminal) : undefined;
    return skill ? `${path.basename(skill.directory)}/${CRIMINAL_QUALIFIER_INDEX}` : null;
  }

  schemas():
    NormalizedToolSchema[] {
    return [
      SKILL_SCHEMA,
      RESOURCE_LIST_SCHEMA,
      RESOURCE_READ_SCHEMA
    ];
  }

  handles(
    name: string
  ): boolean {
    return [
      LIST_SKILLS,
      LIST_RESOURCES,
      READ_RESOURCE
    ].includes(name);
  }

  systemPromptAppendix():
    string {
    const available =
      [...this.registry.skills
        .keys()]
        .sort()
        .join(", ");

    return [
      "# LOCAL LEGAL CORPUS ACCESS",
      "The complete Lex Machina legal corpus is available locally through list_legal_skills, list_legal_resources and read_legal_resource.",
      "Mandatory deterministic workflow resources are preloaded and audited by the runtime before semantic execution; do not repeat those reads merely to satisfy a checklist.",
      "Use read_legal_resource only for additional semantic/domain material that the current reasoning step actually needs. Do not pretend a resource was read merely because its filename appeared in a skill.",
      "Use list_legal_resources when the exact module/reference filename is unknown.",
      "A read result is local procedural/domain corpus context, not proof that a statute or judgment is currently valid. Current legal citations must still pass the separate legal verification tools.",
      "Never request or infer arbitrary operating-system paths. Only semantic corpus paths are permitted.",
      "If a resource is truncated, continue with nextOffset until the portion required by the task has been read.",
      "Available top-level skills: " +
        available
    ].join("\n");
  }

  auditEvents():
    LegalCorpusAuditEvent[] {
    return this.events.map(
      (event) => ({
        ...event,
        ...(event.detail
          ? {
              detail: {
                ...event.detail
              }
            }
          : {})
      })
    );
  }

  async runTools(
    calls:
      NormalizedToolCall[]
  ): Promise<
    NormalizedToolResult[]
  > {
    // A router-v3 read in the same round runs first, so a batched round
    // (router + SKILL.md + modules) is not refused for its order.
    const isRouterRead = (call: NormalizedToolCall) =>
      call.name === READ_RESOURCE && call.input.skill === ROUTER_SKILL;
    const order = [
      ...calls.filter(isRouterRead),
      ...calls.filter((call) => !isRouterRead(call))
    ];
    const byId = new Map(
      order.map((call) => [call, this.runOne(call)] as const)
    );
    return calls.map((call) => byId.get(call)!);
  }

  private runOne(
    call: NormalizedToolCall
  ): NormalizedToolResult {
        try {
          const content =
            this.execute(
              call
            );
          return {
            tool_use_id:
              call.id,
            content
          };
        } catch (error) {
          this.events.push({
            tool: call.name,
            target:
              this.targetFor(
                call
              ),
            decision: "BLOCK",
            detail: {
              error:
                error instanceof Error
                  ? error.message
                  : String(
                      error
                    )
            }
          });
          return {
            tool_use_id:
              call.id,
            content:
              JSON.stringify({
                status:
                  "BLOCKED",
                error:
                  error instanceof Error
                    ? error.message
                    : String(
                        error
                      )
              })
          };
        }
  }

  private execute(
    call:
      NormalizedToolCall
  ): string {
    if (
      call.name ===
        LIST_SKILLS
    ) {
      const skills =
        [...this.registry.skills
          .values()]
          .sort(
            (a, b) =>
              a.name.localeCompare(
                b.name,
                "pl"
              )
          )
          .map(
            (skill) => ({
              name:
                skill.name,
              version:
                typeof skill
                  .frontmatter
                  .version ===
                  "string"
                  ? skill
                      .frontmatter
                      .version
                  : null,
              type:
                typeof skill
                  .frontmatter
                  .type ===
                  "string"
                  ? skill
                      .frontmatter
                      .type
                  : null,
              status:
                typeof skill
                  .frontmatter
                  .status ===
                  "string"
                  ? skill
                      .frontmatter
                      .status
                  : null
            })
          );
      this.events.push({
        tool: call.name,
        target:
          "legal-corpus",
        decision:
          "ALLOW",
        detail: {
          count:
            skills.length
        }
      });
      return JSON.stringify({
        status: "OK",
        skills
      });
    }

    if (
      call.name ===
        LIST_RESOURCES
    ) {
      const skillName =
        typeof call.input
          .skill === "string"
          ? call.input.skill
          : "";
      const skill =
        this.registry.get(
          skillName
        );
      if (!skill) {
        throw new Error(
          "LEGAL_SKILL_NOT_FOUND"
        );
      }
      const prefix =
        normalizePrefix(
          call.input.prefix
        );
      const cursor =
        Number.isInteger(
          call.input.cursor
        )
          ? Number(
              call.input.cursor
            )
          : 0;
      if (cursor < 0) {
        throw new Error(
          "INVALID_RESOURCE_CURSOR"
        );
      }
      const resources =
        collectFiles(
          skill.directory,
          prefix
        );
      const page =
        resources.slice(
          cursor,
          cursor +
            RESOURCE_PAGE_SIZE
        );
      const nextCursor =
        cursor +
          page.length <
        resources.length
          ? cursor +
            page.length
          : null;

      this.events.push({
        tool: call.name,
        target:
          skillName,
        decision:
          "ALLOW",
        detail: {
          prefix,
          returned:
            page.length,
          total:
            resources.length
        }
      });

      return JSON.stringify({
        status: "OK",
        skill:
          skillName,
        prefix,
        resources: page,
        nextCursor
      });
    }

    if (
      call.name ===
        READ_RESOURCE
    ) {
      const requestedSkill =
        typeof call.input
          .skill === "string"
          ? call.input.skill.trim()
          : "";
      const semanticPath =
        typeof call.input
          .path === "string"
          ? call.input.path
              .trim()
          : "";
      if (
        !requestedSkill ||
        !semanticPath
      ) {
        throw new Error(
          "LEGAL_RESOURCE_REQUEST_INVALID"
        );
      }
      let skillName = requestedSkill;
      if (!this.registry.get(skillName)) {
        const skills = looseSkill(this.registry, skillName);
        if (skills.length !== 1) {
          return this.notFound(call, "LEGAL_SKILL_NOT_FOUND", {
            skillCandidates: skills.slice(0, MAX_RESOURCE_CANDIDATES)
          });
        }
        skillName = skills[0]!;
      }

      let resolved =
        this.registry
          .resolveResource(
            skillName,
            semanticPath
          );
      let resolvedFrom: string | undefined;
      if (!resolved) {
        const loose = looseResource(this.registry, skillName, semanticPath);
        resolved = loose.match
          ? this.registry.resolveResource(loose.matchSkill ?? skillName, loose.match)
          : null;
        if (!resolved) {
          return this.notFound(call, "LEGAL_RESOURCE_NOT_FOUND", {
            skill: skillName,
            candidates: loose.candidates
          });
        }
        resolvedFrom = semanticPath;
      }
      if (skillName !== requestedSkill || resolvedFrom) {
        resolvedFrom = `${requestedSkill}/${semanticPath}`;
      }
      if (
        !fs.statSync(
          resolved
        ).isFile()
      ) {
        throw new Error(
          "LEGAL_RESOURCE_NOT_FILE"
        );
      }

      const resolvedPath =
        path.relative(
          this.registry.root,
          resolved
        )
        .replaceAll(
          path.sep,
          "/"
        );
      const targetSkill =
        this.skillForPath(
          resolvedPath
        );
      // Already in the model's context (loaded by the application this turn): no second copy.
      const requestedOffset = Number.isInteger(call.input.offset) ? Number(call.input.offset) : 0;
      if (requestedOffset === 0 && this.inContext.has(resolvedPath)) {
        if (targetSkill !== null && resolvedPath.split("/").length === 2 && resolvedPath.endsWith("/SKILL.md")) {
          if (!this.readSkills.includes(targetSkill)) this.readSkills.push(targetSkill);
          this.cover(targetSkill, 0, 0, 0, "preloaded");
        }
        if (targetSkill?.startsWith(CRIMINAL_DOMAIN_PREFIX) && resolvedPath.endsWith(`/${CRIMINAL_QUALIFIER_INDEX}`)) this.qualifierDelivered = true;
        this.events.push({ tool: call.name, target: resolvedPath, decision: "ALLOW", detail: { inContext: true, returnedChars: 0 } });
        return JSON.stringify({
          status: "OK",
          path: resolvedPath,
          inContext: true,
          content: "",
          note: "Aplikacja wczytała ten plik do kontekstu w tej turze (sekcja z tą ścieżką w instrukcjach). Korzystaj z tamtej treści; nie czytaj go ponownie."
        });
      }
      if (this.inContext.has(`${ROUTER_SKILL}/SKILL.md`) && !this.readSkills.includes(ROUTER_SKILL)) this.readSkills.push(ROUTER_SKILL);
      // Router v3 is always first. When the model asks for another legal
      // resource before it, the router entry is delivered with that read
      // (like the criminal qualifier) instead of refusing it and costing a
      // whole model round.
      let requiredRouter:
        | { path: string; content: string; truncated: boolean }
        | undefined;
      if (
        this.options.modelSelectsSkills &&
        targetSkill !== ROUTER_SKILL &&
        !this.readSkills.includes(
          ROUTER_SKILL
        )
      ) {
        const router =
          this.registry.resolveResource(
            ROUTER_SKILL,
            "SKILL.md"
          );
        if (!router) {
          throw new Error(
            "ROUTER_V3_REQUIRED_FIRST: read skill=prawny-router-v3 path=SKILL.md before any other legal resource"
          );
        }
        const routerText = textFile(router);
        const routerPath =
          path.relative(this.registry.root, router).replaceAll(path.sep, "/");
        requiredRouter = {
          path: routerPath,
          content: routerText.slice(0, MAX_READ_CHARS),
          truncated: routerText.length > MAX_READ_CHARS
        };
        this.readSkills.push(ROUTER_SKILL);
        this.events.push({
          tool: call.name,
          target: routerPath,
          decision: "ALLOW",
          detail: {
            deliveredWith: resolvedPath,
            returnedChars: requiredRouter.content.length,
            totalChars: routerText.length
          }
        });
      }

      const text =
        textFile(
          resolved
        );
      const offset =
        Number.isInteger(
          call.input.offset
        )
          ? Number(
              call.input.offset
            )
          : 0;
      const maxChars =
        Number.isInteger(
          call.input
            .maxChars
        )
          ? Math.min(
              MAX_READ_CHARS,
              Math.max(
                1,
                Number(
                  call.input
                    .maxChars
                )
              )
            )
          : MAX_READ_CHARS;
      if (
        offset < 0 ||
        offset >
          text.length
      ) {
        throw new Error(
          "INVALID_RESOURCE_OFFSET"
        );
      }

      const content =
        text.slice(
          offset,
          offset +
            maxChars
        );
      const nextOffset =
        offset +
          content.length <
        text.length
          ? offset +
            content.length
          : null;
      const canonicalPath =
        path.relative(
          this.registry.root,
          resolved
        )
        .replaceAll(
          path.sep,
          "/"
        );

      const isSkillEntry =
        targetSkill !== null &&
        resolvedPath.split("/").length === 2 &&
        resolvedPath.endsWith("/SKILL.md");
      if (
        isSkillEntry &&
        !this.readSkills.includes(
          targetSkill
        )
      ) {
        this.readSkills.push(
          targetSkill
        );
      }
      if (isSkillEntry) this.cover(targetSkill, text.length, offset, offset + content.length, "tool");
      // prawo-polskie-v2: DR-skill -> act module. With the domain's SKILL.md, the
      // modules of its MAPA-AKTOW that the case text points to (a suggestion).
      const domainModules =
        isSkillEntry && offset === 0 && /^dr-\d{2}-/.test(targetSkill) && this.caseText.trim()
          ? suggestDomainModules(this.registry, targetSkill, this.caseText)
          : [];
      // A criminal-law matter always goes through the qualifier: it is
      // delivered with the first DR-03 skill entry, not left to the model.
      let requiredModule:
        | { path: string; content: string }
        | undefined;
      // The application already gave the qualifier: not delivered a second time.
      if (isSkillEntry && this.inContext.has(`${targetSkill}/${CRIMINAL_QUALIFIER_INDEX}`)) this.qualifierDelivered = true;
      if (
        this.options.modelSelectsSkills &&
        isSkillEntry &&
        targetSkill.startsWith(
          CRIMINAL_DOMAIN_PREFIX
        ) &&
        !this.qualifierDelivered
      ) {
        const qualifier =
          this.registry.resolveResource(
            targetSkill,
            CRIMINAL_QUALIFIER_INDEX
          );
        if (!qualifier) {
          throw new Error(
            "CRIMINAL_QUALIFIER_MISSING"
          );
        }
        requiredModule = {
          path:
            `${targetSkill}/${CRIMINAL_QUALIFIER_INDEX}`,
          content:
            textFile(
              qualifier
            ).slice(
              0,
              MAX_READ_CHARS
            )
        };
        this.qualifierDelivered = true;
        this.events.push({
          tool: call.name,
          target:
            requiredModule.path,
          decision:
            "ALLOW",
          detail: {
            deliveredWith:
              resolvedPath
          }
        });
      }

      this.events.push({
        tool: call.name,
        target:
          canonicalPath,
        decision:
          "ALLOW",
        detail: {
          ...(resolvedFrom ? { resolvedFrom } : {}),
          offset,
          returnedChars:
            content.length,
          totalChars:
            text.length,
          truncated:
            nextOffset !== null
        }
      });

      return JSON.stringify({
        status: "OK",
        path:
          canonicalPath,
        ...(resolvedFrom
          ? {
              requestedPath: resolvedFrom,
              note: "The requested path does not exist; this is the only matching file. Use this path from now on."
            }
          : {}),
        offset,
        returnedChars:
          content.length,
        totalChars:
          text.length,
        nextOffset,
        content,
        ...(isSkillEntry && nextOffset !== null
          ? {
              instruction:
                `SKILL.md of ${targetSkill} continues (${text.length} characters). Read the rest with offset=${nextOffset} before applying the skill: a skill read only in part does not count as read, and its pipeline and gates are often at the end.`
            }
          : {}),
        ...(requiredRouter
          ? {
              requiredRouter: {
                ...requiredRouter,
                instruction:
                  "Mandatory prawny-router-v3 entry, delivered with the first legal resource. Apply its routing; read further router files only if the routing needs them."
              }
            }
          : {}),
        ...(domainModules.length
          ? {
              domainModules: {
                suggested: domainModules.map((module) => ({ path: module.resource, why: module.why })),
                instruction:
                  "Act modules of this domain's MAPA-AKTOW that the case points to (application suggestion). Read the one that governs the case before applying the domain; if the case is governed by another module of the map, read that one and say why."
              }
            }
          : {}),
        ...(requiredModule
          ? {
              requiredModule: {
                ...requiredModule,
                instruction:
                  "Mandatory criminal-law qualifier. Apply it before any criminal-law qualification."
              }
            }
          : {})
      });
    }

    throw new Error(
      "UNKNOWN_LEGAL_CORPUS_TOOL"
    );
  }

  /** Not found, but with what the model can read instead (no extra listing round). */
  private notFound(
    call: NormalizedToolCall,
    error: string,
    hints: { skill?: string; candidates?: string[]; skillCandidates?: string[] }
  ): string {
    this.events.push({
      tool: call.name,
      target: this.targetFor(call),
      decision: "BLOCK",
      detail: { error, ...hints }
    });
    return JSON.stringify({
      status: "NOT_FOUND",
      error,
      ...hints,
      instruction: hints.candidates?.length || hints.skillCandidates?.length
        ? "Read the right one from these candidates in your next call (closest first, at most 12; if none fits, list_legal_resources); do not guess other names."
        : "No similar file. Use list_legal_resources for this skill instead of guessing names."
    });
  }

  private skillForPath(
    relativePath: string
  ): string | null {
    const directory =
      relativePath.split("/", 1)[0];
    for (const skill of this.registry.skills.values()) {
      if (
        path.basename(
          skill.directory
        ) === directory
      ) {
        return skill.name;
      }
    }
    return null;
  }

  private targetFor(
    call:
      NormalizedToolCall
  ): string {
    const skill =
      typeof call.input
        .skill === "string"
        ? call.input.skill
        : "legal-corpus";
    const resource =
      typeof call.input
        .path === "string"
        ? call.input.path
        : "";
    return resource
      ? `${skill}:${resource}`
      : skill;
  }
}

export const LEGAL_CORPUS_TOOL_NAMES =
  new Set([
    LIST_SKILLS,
    LIST_RESOURCES,
    READ_RESOURCE
  ]);
