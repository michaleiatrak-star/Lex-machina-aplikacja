import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Windows PowerShell 5.1: under $ErrorActionPreference = "Stop" a native command's redirected
// stderr (2>&1, 2> file) turns any warning into a terminating error. Every such call in the
// installer scripts runs with the preference switched to "Continue" just around it.
const INSTALLER = path.resolve(__dirname, "../../installer");
const REDIRECT = /(?:^|\s)2>(?:&1|\s*\S)/u;
const PREFERENCE = /\$ErrorActionPreference\s*=\s*(?:"([A-Za-z]+)"|'([A-Za-z]+)'|\$(\w+))/u;

function violations(file: string): string[] {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/u);
  let preference = "Continue";
  const found: string[] = [];
  lines.forEach((line, index) => {
    const code = line.replace(/#.*$/u, "");
    const set = PREFERENCE.exec(code);
    if (set) preference = set[1] ?? set[2] ?? `$${set[3]}`;
    if (REDIRECT.test(code) && /^\s*(?:\$\w+\s*=\s*)?&/u.test(code) && preference === "Stop") {
      found.push(`${path.basename(file)}:${index + 1}: ${line.trim()}`);
    }
  });
  return found;
}

describe("skrypty instalatora: przekierowanie stderr przy trybie Stop (PowerShell 5.1)", () => {
  it("żadne wywołanie programu z 2>&1 / 2> nie działa przy $ErrorActionPreference = \"Stop\"", () => {
    const files = fs.readdirSync(INSTALLER).filter((name) => name.endsWith(".ps1")).map((name) => path.join(INSTALLER, name));
    expect(files.length).toBeGreaterThan(10);
    expect(files.flatMap(violations)).toEqual([]);
  });

  it("wykrywa wywołanie bez przełączenia trybu", () => {
    const sample = path.join(__dirname, "fixtures-ps-stderr.ps1");
    fs.writeFileSync(sample, '$ErrorActionPreference = "Stop"\n$out = & $python -c "import x" 2>&1\n');
    try {
      expect(violations(sample)).toHaveLength(1);
    } finally {
      fs.rmSync(sample);
    }
  });
});
