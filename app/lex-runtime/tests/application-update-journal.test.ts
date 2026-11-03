import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lastFailedApplicationUpdate } from "../src/application-update-journal.js";

function journal(value: unknown, bom = false): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lex-update-journal-")), "update-transaction.json");
  fs.writeFileSync(file, `${bom ? "﻿" : ""}${JSON.stringify(value)}`);
  return file;
}

describe("the last application update attempt", () => {
  it("a rejected update keeps its reason for the next start (0.1.51 -> 0.1.52 closed with no trace)", () => {
    expect(lastFailedApplicationUpdate(journal({ state: "REJECTED", targetVersion: "0.1.52", lastError: "UPDATE_INSTALLER_PRODUCT_VERSION_MISMATCH:expected=0.1.52 actual=0.1.51", startedAt: "2026-10-31T10:00:00Z" }, true))).toEqual({
      state: "REJECTED",
      targetVersion: "0.1.52",
      lastError: "UPDATE_INSTALLER_PRODUCT_VERSION_MISMATCH:expected=0.1.52 actual=0.1.51",
      at: "2026-10-31T10:00:00Z"
    });
  });

  it("a committed or running update, or no journal, is no failure", () => {
    expect(lastFailedApplicationUpdate(journal({ state: "COMMITTED", targetVersion: "0.1.52" }))).toBeNull();
    expect(lastFailedApplicationUpdate(journal({ state: "INSTALLING", targetVersion: "0.1.52" }))).toBeNull();
    expect(lastFailedApplicationUpdate(path.join(os.tmpdir(), "missing-lex-journal.json"))).toBeNull();
  });

  it("a step in progress for over 30 minutes is an interrupted update (the runner was ended)", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    expect(lastFailedApplicationUpdate(journal({ state: "INSTALLING", targetVersion: "0.1.55", startedAt: "2026-11-03T11:00:00Z" }), now)).toEqual({
      state: "INTERRUPTED",
      targetVersion: "0.1.55",
      lastError: "INTERRUPTED_AT:INSTALLING",
      at: "2026-11-03T11:00:00Z"
    });
    expect(lastFailedApplicationUpdate(journal({ state: "VERIFYING", targetVersion: "0.1.55", startedAt: "2026-11-03T11:50:00Z" }), now)).toBeNull();
  });
});
