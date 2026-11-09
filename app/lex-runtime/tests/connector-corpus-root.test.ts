import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connectorCorpusRoot } from "../src/http/server.js";

const made: string[] = [];
const saved = process.env.LEX_BUNDLED_SKILLS_PATH;
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  if (saved === undefined) delete process.env.LEX_BUNDLED_SKILLS_PATH;
  else process.env.LEX_BUNDLED_SKILLS_PATH = saved;
});

function corpus(withConnectors: boolean): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-corpus-"));
  made.push(root);
  if (withConnectors) {
    const dist = path.join(root, "prawo-polskie-v2", "mcp-servers", "dist");
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, "lex-mcp.mjs"), "export {};\n");
  }
  return root;
}

describe("MCP connectors after a skills update without mcp-servers", () => {
  it("the installer's corpus (LEX_BUNDLED_SKILLS_PATH) supplies the package the updated skills lack", () => {
    const updated = corpus(false);
    const installer = corpus(true);
    process.env.LEX_BUNDLED_SKILLS_PATH = installer;
    expect(connectorCorpusRoot(updated, updated)).toBe(installer);
  });

  it("the updated skills win when they carry the package", () => {
    const updated = corpus(true);
    process.env.LEX_BUNDLED_SKILLS_PATH = corpus(true);
    expect(connectorCorpusRoot(updated, updated)).toBe(updated);
  });
});
