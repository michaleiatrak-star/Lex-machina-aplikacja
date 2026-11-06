import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
const USER_ID = /^[A-Za-z0-9_-]{1,80}$/u;
const GROUP_ID = /^grp_[a-f0-9]{24}$/u;
const MAX_GROUPS = 200;
const MAX_MEMBERS = 500;
export class UserGroupError extends Error {
    code;
    httpStatus;
    constructor(code, httpStatus) {
        super(code);
        this.code = code;
        this.httpStatus = httpStatus;
    }
}
function clean(name) {
    const value = typeof name === "string" ? name.replace(/\s+/gu, " ").trim() : "";
    if (!value || value.length > 80)
        throw new UserGroupError("USER_GROUP_NAME_INVALID", 400);
    return value;
}
function members(ids, known) {
    if (!Array.isArray(ids) || ids.length > MAX_MEMBERS)
        throw new UserGroupError("USER_GROUP_MEMBERS_INVALID", 400);
    const unique = [...new Set(ids)];
    if (!unique.every((id) => typeof id === "string" && USER_ID.test(id) && known(id))) {
        throw new UserGroupError("USER_GROUP_MEMBERS_INVALID", 400);
    }
    return unique;
}
export class UserGroupStore {
    rootDir;
    userExists;
    now;
    queue = Promise.resolve();
    constructor(rootDir, userExists, now = () => new Date()) {
        this.rootDir = rootDir;
        this.userExists = userExists;
        this.now = now;
    }
    get file() {
        return path.join(this.rootDir, "user-groups.json");
    }
    async list() {
        try {
            const parsed = JSON.parse(await readFile(this.file, "utf8"));
            return (parsed.groups ?? []).filter((group) => GROUP_ID.test(group.groupId));
        }
        catch {
            return [];
        }
    }
    async get(groupId) {
        const group = (await this.list()).find((item) => item.groupId === groupId);
        if (!group)
            throw new UserGroupError("USER_GROUP_NOT_FOUND", 404);
        return group;
    }
    change(update) {
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
    async create(input) {
        const name = clean(input.name);
        const memberUserIds = members(input.memberUserIds ?? [], this.userExists);
        return this.change((groups) => {
            if (groups.length >= MAX_GROUPS)
                throw new UserGroupError("USER_GROUP_LIMIT_EXCEEDED", 409);
            if (groups.some((group) => group.name.toLowerCase() === name.toLowerCase()))
                throw new UserGroupError("USER_GROUP_NAME_TAKEN", 409);
            const at = this.now().toISOString();
            const group = { groupId: `grp_${randomBytes(12).toString("hex")}`, name, memberUserIds, createdAt: at, updatedAt: at };
            return { groups: [...groups, group], result: group };
        });
    }
    async update(groupId, input) {
        const name = input.name === undefined ? undefined : clean(input.name);
        const ids = input.memberUserIds === undefined ? undefined : members(input.memberUserIds, this.userExists);
        return this.change((groups) => {
            const index = groups.findIndex((group) => group.groupId === groupId);
            if (index < 0)
                throw new UserGroupError("USER_GROUP_NOT_FOUND", 404);
            if (name && groups.some((group, i) => i !== index && group.name.toLowerCase() === name.toLowerCase())) {
                throw new UserGroupError("USER_GROUP_NAME_TAKEN", 409);
            }
            const group = { ...groups[index], ...(name ? { name } : {}), ...(ids ? { memberUserIds: ids } : {}), updatedAt: this.now().toISOString() };
            const next = [...groups];
            next[index] = group;
            return { groups: next, result: group };
        });
    }
    async remove(groupId) {
        return this.change((groups) => {
            if (!groups.some((group) => group.groupId === groupId))
                throw new UserGroupError("USER_GROUP_NOT_FOUND", 404);
            return { groups: groups.filter((group) => group.groupId !== groupId), result: undefined };
        });
    }
}
/**
 * Shares a case with every member of a group: one grant per member (each with the case key
 * wrapped for that member). The caller, members already with access and members whose
 * encryption keys are not ready yet are skipped and reported.
 */
export async function shareWithGroup(args) {
    const result = { granted: [], skipped: [] };
    for (const userId of args.group.memberUserIds) {
        if (userId === args.actorUserId)
            continue;
        if (args.hasAccess(userId)) {
            result.skipped.push({ userId, reason: "ALREADY_HAS_ACCESS" });
            continue;
        }
        try {
            await args.grant(userId);
            result.granted.push(userId);
        }
        catch (error) {
            const code = error.code;
            result.skipped.push({ userId, reason: typeof code === "string" ? code : "GRANT_FAILED" });
        }
    }
    return result;
}
