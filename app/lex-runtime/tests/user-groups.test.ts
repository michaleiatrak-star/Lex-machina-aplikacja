import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { shareWithGroup, UserGroupStore } from "../src/user-groups.js";

const users = new Set(["user_anna", "user_jan", "user_ewa"]);
const store = () => new UserGroupStore(fs.mkdtempSync(path.join(os.tmpdir(), "lex-groups-")), (id) => users.has(id));

describe("grupy użytkowników", () => {
  it("tworzy, zmienia i usuwa; nazwa unikalna bez względu na wielkość liter; tylko istniejący użytkownicy", async () => {
    const groups = store();
    const team = await groups.create({ name: "  Zespół   procesowy ", memberUserIds: ["user_anna", "user_jan", "user_jan"] });
    expect(team).toMatchObject({ name: "Zespół procesowy", memberUserIds: ["user_anna", "user_jan"] });
    expect(team.groupId).toMatch(/^grp_[a-f0-9]{24}$/u);
    await expect(groups.create({ name: "zespół PROCESOWY", memberUserIds: [] })).rejects.toThrow("USER_GROUP_NAME_TAKEN");
    await expect(groups.create({ name: "Inna", memberUserIds: ["user_obcy"] })).rejects.toThrow("USER_GROUP_MEMBERS_INVALID");
    await expect(groups.create({ name: "", memberUserIds: [] })).rejects.toThrow("USER_GROUP_NAME_INVALID");
    const updated = await groups.update(team.groupId, { memberUserIds: ["user_ewa"] });
    expect(updated.memberUserIds).toEqual(["user_ewa"]);
    expect((await groups.list()).map((group) => group.name)).toEqual(["Zespół procesowy"]);
    await groups.remove(team.groupId);
    expect(await groups.list()).toEqual([]);
    await expect(groups.get(team.groupId)).rejects.toThrow("USER_GROUP_NOT_FOUND");
  });

  it("równoległe zmiany nie gubią grup", async () => {
    const groups = store();
    await Promise.all(["A", "B", "C", "D"].map((name) => groups.create({ name, memberUserIds: [] })));
    expect((await groups.list()).map((group) => group.name).sort()).toEqual(["A", "B", "C", "D"]);
  });

  it("udostępnienie grupie: każdy członek osobno; siebie i mających dostęp pomija; błąd jednego nie zatrzymuje reszty", async () => {
    const granted: string[] = [];
    const result = await shareWithGroup({
      group: { groupId: "grp_x", name: "Zespół", memberUserIds: ["user_anna", "user_jan", "user_ewa", "user_ola"], createdAt: "", updatedAt: "" },
      actorUserId: "user_anna",
      hasAccess: (id) => id === "user_jan",
      grant: async (id) => {
        if (id === "user_ola") throw Object.assign(new Error("x"), { code: "TARGET_CRYPTO_NOT_READY" });
        granted.push(id);
      }
    });
    expect(result).toEqual({
      granted: ["user_ewa"],
      skipped: [
        { userId: "user_jan", reason: "ALREADY_HAS_ACCESS" },
        { userId: "user_ola", reason: "TARGET_CRYPTO_NOT_READY" }
      ]
    });
    expect(granted).toEqual(["user_ewa"]);
  });
});
