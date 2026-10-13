// Buduje wspolne/akt-pdf.mjs serwerów MCP skilli z kodu RAG aplikacji.
// Użycie: npm run build:akt-pdf [-- <katalog mcp-servers>] (domyślnie kopia korpusu w repo aplikacji).
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const servers = path.resolve(process.argv[2] ?? path.join(here, "../../../Wersja rozwojowa rozpakowana/audyt-systemu-v4/mcp-servers"));
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: here }).toString().trim();
await build({
  entryPoints: [path.join(here, "akt-pdf.entry.ts")],
  outfile: path.join(servers, "wspolne/akt-pdf.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  banner: {
    js: [
      "// WYGENEROWANE z aplikacji Lex Machina (app/lex-runtime/src: pdf-text-extractor.ts, core-law-index.ts,",
      `// core-law-footnotes.ts, source-anchor.ts; commit ${commit}) — nie edytować ręcznie.`,
      "// Ten sam odczyt PDF t.j. co RAG aplikacji (wiersze z geometrii, przypisy, brzmienie obowiązujące).",
      "// Regeneracja: w aplikacji `npm run build:akt-pdf` (app/lex-runtime/scripts/akt-pdf.entry.ts)."
    ].join("\n")
  }
});
console.log(path.join(servers, "wspolne/akt-pdf.mjs"));
