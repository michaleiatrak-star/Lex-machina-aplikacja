import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Named groups of users (a team, a department) to share a case with at once. A group holds
 * names and user ids only: sharing a case with it still wraps the case key for each member
 * separately (case-access.ts), so the encryption of a case is the same as shared one by one.
 * A member added to a group later gets the case when it is shared with the group again.
 */

export type UserGroup = {
  groupId: string;
  name: string;
  memberUserIds: string[];
  createdAt: string;
  updatedAt: string;
};

const USER_ID = /^[A-Za-z0-9_-]{1,80}$/u;
const GROUP_ID = /^grp_[a-f0-9]{24}$/u;
const MAX_GROUPS = 200;
const MAX_MEMBERS = 500;

export class UserGroupError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number
  ) {
    super(code);
  }
}

function clean(name: unknown): string {
  const value = typeof name === "string" ? name.replace(/\s+/gu, " ").trim() : "";
  if (!value || value.length > 80) throw new UserGroupError("USER_GROUP_NAME_INVALID", 400);
  return value;
}

function members(ids: unknown, known: (userId: string) => boolean): string[] {
  if (!Array.isArray(ids) || ids.length > MAX_MEMBERS) throw new UserGroupError("USER_GROUP_MEMBERS_INVALID", 400);
  const unique = [...new Set(ids)];
  if (!unique.every((id): id is string => typeof id === "string" && USER_ID.test(id) && known(id))) {
    throw new UserGroupError("USER_GROUP_MEMBERS_INVALID", 400);
  }
  return unique;
}

export class UserGroupStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly rootDir: string,
    private readonly userExists: (userId: string) => boolean,
    private readonly now: () => Date = () => new Date()
  ) {}

  private get file(): string {
    return path.join(this.rootDir, "user-groups.json");
  }

  async list(): Promise<UserGroup[]> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as { groups?: UserGroup[] };
      return (parsed.groups ?? []).filter((group) => GROUP_ID.test(group.groupId));
    } catch {
      return [];
    }
  }

  async get(groupId: string): Promise<UserGroup> {
    const group = (await this.list()).find((item) => item.groupId === groupId);
    if (!group) throw new UserGroupError("USER_GROUP_NOT_FOUND", 404);
    return group;
  }

  private change<T>(update: (groups: UserGroup[]) => { groups: UserGroup[]; result: T }): Promise<T> {
    const run = this.queue.then(async () => {
      const { groups, result } = update(await this.list());
      await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
      const temp = `${this.file}.${randomBytes(4).toString("hex")}.tmp`;
      await writeFile(temp, JSON.stringify({ schemaVersion: 1, groups }, null, 2), { mode: 0o600 });
      await rename(temp, this.file);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async create(input: { name: unknown; memberUserIds: unknown }): Promise<UserGroup> {
    const name = clean(input.name);
    const memberUserIds = members(input.memberUserIds ?? [], this.userExists);
    return this.change((groups) => {
      if (groups.length >= MAX_GROUPS) throw new UserGroupError("USER_GROUP_LIMIT_EXCEEDED", 409);
      if (groups.some((group) => group.name.toLowerCase() === name.toLowerCase())) throw new UserGroupError("USER_GROUP_NAME_TAKEN", 409);
      const at = this.now().toISOString();
      const group: UserGroup = { groupId: `grp_${randomBytes(12).toString("hex")}`, name, memberUserIds, createdAt: at, updatedAt: at };
      return { groups: [...groups, group], result: group };
    });
  }

  async update(groupId: string, input: { name?: unknown; memberUserIds?: unknown }): Promise<UserGroup> {
    const name = input.name === undefined ? undefined : clean(input.name);
    const ids = input.memberUserIds === undefined ? undefined : members(input.memberUserIds, this.userExists);
    return this.change((groups) => {
      const index = groups.findIndex((group) => group.groupId === groupId);
      if (index < 0) throw new UserGroupError("USER_GROUP_NOT_FOUND", 404);
      if (name && groups.some((group, i) => i !== index && group.name.toLowerCase() === name.toLowerCase())) {
        throw new UserGroupError("USER_GROUP_NAME_TAKEN", 409);
      }
      const group = { ...groups[index]!, ...(name ? { name } : {}), ...(ids ? { memberUserIds: ids } : {}), updatedAt: this.now().toISOString() };
      const next = [...groups];
      next[index] = group;
      return { groups: next, result: group };
    });
  }

  async remove(groupId: string): Promise<void> {
    return this.change((groups) => {
      if (!groups.some((group) => group.groupId === groupId)) throw new UserGroupError("USER_GROUP_NOT_FOUND", 404);
      return { groups: groups.filter((group) => group.groupId !== groupId), result: undefined };
    });
  }
}

export type GroupShareResult = {
  granted: string[];
  skipped: Array<{ userId: string; reason: string }>;
};

/**
 * Shares a case with every member of a group: one grant per member (each with the case key
 * wrapped for that member). The caller, members already with access and members whose
 * encryption keys are not ready yet are skipped and reported.
 */
export async function shareWithGroup(args: {
  group: UserGroup;
  actorUserId: string;
  hasAccess: (userId: string) => boolean;
  grant: (userId: string) => Promise<unknown>;
}): Promise<GroupShareResult> {
  const result: GroupShareResult = { granted: [], skipped: [] };
  for (const userId of args.group.memberUserIds) {
    if (userId === args.actorUserId) continue;
    if (args.hasAccess(userId)) {
      result.skipped.push({ userId, reason: "ALREADY_HAS_ACCESS" });
      continue;
    }
    try {
      await args.grant(userId);
      result.granted.push(userId);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      result.skipped.push({ userId, reason: typeof code === "string" ? code : "GRANT_FAILED" });
    }
  }
  return result;
}
