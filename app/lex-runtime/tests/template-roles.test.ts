import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DOCX_MEDIA_TYPE, LocalSharedTemplateStore } from "../src/shared-template-store.js";
import { defaultTemplateFor, draftingTarget } from "../src/template-roles.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-template-roles-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("what the user asks to draft", () => {
  it.each([
    ["Napisz umowę najmu lokalu użytkowego", "umowa"],
    ["Przygotuj regulamin sklepu internetowego", "regulamin"],
    ["Napisz pozew o zapłatę", "pozew"],
    ["Sporządź odpowiedź na pozew", "odpowiedz_na_pozew"],
    ["Zredaguj apelację od wyroku", "apelacja"],
    ["Napisz wezwanie do zapłaty", "wezwanie"]
  ])("%s -> %s", (question, kind) => {
    expect(draftingTarget(question)).toBe(kind);
  });

  it("a question about a contract is not a drafting request; a generation request names the family", () => {
    expect(draftingTarget("Czy ta umowa najmu jest korzystna?")).toBeNull();
    expect(draftingTarget("Proszę o dokument", "contract")).toBe("umowa");
  });
});

describe("the firm's default template per kind", () => {
  it("one default per kind, chosen for the drafting request", async () => {
    const store = new LocalSharedTemplateStore({ rootDir: root });
    // A minimal DOCX is a ZIP; the store only checks the media type and signature.
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(64).fill(0)]);
    const first = await store.saveTemplate({ filename: "umowa-najmu.docx", mediaType: DOCX_MEDIA_TYPE, data: zip, createdByUserId: `user_${"a".repeat(32)}` });
    const second = await store.saveTemplate({ filename: "umowa-nowa.docx", mediaType: DOCX_MEDIA_TYPE, data: zip.slice(), createdByUserId: `user_${"a".repeat(32)}` });
    await store.setRole(first.templateId, { kind: "umowa", isDefault: true });
    await store.setRole(second.templateId, { kind: "umowa", isDefault: true });
    const templates = await store.listTemplates();
    expect(templates.filter((template) => template.role?.isDefault).map((template) => template.templateId)).toEqual([second.templateId]);
    expect(defaultTemplateFor(templates, "umowa")?.templateId).toBe(second.templateId);
    // Regulamin has no default of its own: the contract family's default.
    expect(defaultTemplateFor(templates, "regulamin")?.templateId).toBe(second.templateId);
    expect(defaultTemplateFor(templates, "pozew")).toBeNull();
    await store.setRole(second.templateId, null);
    expect((await store.listTemplates()).find((template) => template.templateId === second.templateId)?.role).toBeUndefined();
  });
});
