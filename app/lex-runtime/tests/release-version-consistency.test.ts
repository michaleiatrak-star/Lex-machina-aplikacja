import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every file that carries the application's version agrees (the macOS installer stopped
// 0.1.39 with VERSION_MISMATCH: distribution.xml still said 0.1.38).
const APP = path.resolve(__dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(APP, file), "utf8");
const json = (file: string) => JSON.parse(read(file)) as Record<string, unknown>;

describe("release version", () => {
  it("is the same in tauri.conf.json, the release manifests, the macOS distribution, the packages and lex-version.yaml", () => {
    const version = json("lex-desktop/src-tauri/tauri.conf.json").version as string;
    expect(version).toMatch(/^\d+\.\d+\.\d+$/u);
    const found = {
      "installer/macos-release-source.json": json("installer/macos-release-source.json").applicationVersion,
      "installer/windows-release-source.json": json("installer/windows-release-source.json").applicationVersion,
      "installer/macos/distribution.xml": /<pkg-ref id="pl\.lexmachina\.desktop" version="([^"]+)"/u.exec(read("installer/macos/distribution.xml"))?.[1],
      "lex-version.yaml": /^application_version:\s*"([^"]+)"/mu.exec(read("lex-version.yaml"))?.[1],
      "lex-desktop/package.json": json("lex-desktop/package.json").version,
      "lex-desktop/src-tauri/Cargo.toml": /^version\s*=\s*"([^"]+)"/mu.exec(read("lex-desktop/src-tauri/Cargo.toml"))?.[1],
      "lex-runtime/package.json": json("lex-runtime/package.json").version,
      "lex-web/package.json": json("lex-web/package.json").version
    };
    expect(found).toEqual(Object.fromEntries(Object.keys(found).map((file) => [file, version])));
  });
});
