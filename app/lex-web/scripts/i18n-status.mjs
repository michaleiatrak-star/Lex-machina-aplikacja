// State of the translations, element by element and language by language: written to
// src/locales/status.json (shown in the app, Settings > Appearance > translation status).
// Interface components are measured from the code: texts already passed through t() (translatable),
// Polish texts not yet passed (not translatable yet), and how many of the translatable ones each
// language's catalog has. Areas outside the web interface (installers, the model's answers) are
// described in src/locales/areas.json and checked here only for their languages' list.
//   node scripts/i18n-status.mjs          write status.json
//   node scripts/i18n-status.mjs --check  fail when status.json is out of date
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const src = path.join(root, "src");
const localesDir = path.join(src, "locales");
const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]|\b(?:i|w|z|na|do|nie|się|jest|oraz|lub|dla|przez|od|po)\b/u;
// Attributes whose text the user reads.
const SHOWN_ATTRIBUTES = new Set(["title", "placeholder", "aria-label", "alt", "label", "aria-description"]);

// Names, codes and units that stay as they are in every language (Lex Machina, ELI, DOCX, ms).
const CODE_LIKE = (text) => /^[A-Z0-9 .·\-/_:+()]+$/u.test(text) || /^(Lex Machina|ms|Aa|KSeF|NIP:?|MB ·)$/u.test(text);

function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function isTCall(node) {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === "t" || node.expression.text === "N_");
}

/** Texts of one component: passed through t(), and Polish texts shown to the user without it. */
export function measure(file, code) {
  const sourceFile = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const keys = new Set();
  const untranslated = [];
  const visit = (node) => {
    if (isTCall(node)) {
      const text = node.arguments[0] && literalText(node.arguments[0]);
      if (text) keys.add(text);
      return;
    }
    if (ts.isJsxText(node)) {
      const text = node.text.replace(/\s+/gu, " ").trim();
      if (/\p{L}{2,}/u.test(text) && !CODE_LIKE(text)) untranslated.push(text);
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(sourceFile);
      const value = ts.isStringLiteral(node.initializer) ? node.initializer.text : null;
      if (value && SHOWN_ATTRIBUTES.has(name) && /\p{L}{2,}/u.test(value)) untranslated.push(value);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      // Other Polish strings shown in the interface (messages, labels in objects): a sentence
      // with Polish words; identifiers, class names and keys have none.
      const parent = node.parent;
      const shownAttribute = ts.isJsxAttribute(parent);
      const importPath = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent);
      if (!shownAttribute && !importPath && POLISH.test(node.text) && /\s/u.test(node.text)) untranslated.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { keys: [...keys], untranslated };
}

export function buildStatus() {
  const catalogs = Object.fromEntries(
    fs
      .readdirSync(localesDir)
      .filter((name) => /^[a-z]{2,3}\.json$/u.test(name))
      .map((name) => [name.replace(/\.json$/u, ""), JSON.parse(fs.readFileSync(path.join(localesDir, name), "utf8"))])
  );
  // Every interface language (i18n.ts LOCALES), also those without a catalog yet.
  const declared = [...fs.readFileSync(path.join(src, "i18n.ts"), "utf8").matchAll(/\{ code: "([a-z]{2,3})", native:/gu)].map((match) => match[1]);
  const languages = ["pl", ...declared.filter((code) => code !== "pl")];
  const components = fs
    .readdirSync(src)
    .filter((name) => name.endsWith(".tsx") && !name.includes(".test."))
    .sort()
    .map((name) => {
      const { keys, untranslated } = measure(name, fs.readFileSync(path.join(src, name), "utf8"));
      const translated = Object.fromEntries(
        Object.entries(catalogs).map(([code, catalog]) => [code, keys.filter((key) => typeof catalog[key] === "string" && catalog[key].trim()).length])
      );
      const state = Object.fromEntries(
        languages.map((code) => {
          if (code === "pl") return [code, "całość"];
          const done = translated[code] ?? 0;
          if (keys.length === 0) return [code, "wcale"];
          if (untranslated.length === 0 && done === keys.length) return [code, "całość"];
          return [code, done === 0 ? "wcale" : "częściowo"];
        })
      );
      return { component: name.replace(/\.tsx$/u, ""), translatable: keys.length, notYetTranslatable: untranslated.length, translated, state };
    });
  const areas = JSON.parse(fs.readFileSync(path.join(localesDir, "areas.json"), "utf8"));
  const totals = Object.fromEntries(
    languages.map((code) => [code, Object.fromEntries(["całość", "częściowo", "wcale"].map((state) => [state, components.filter((item) => item.state[code] === state).length]))])
  );
  return { languages, totals, components, areas };
}

const outFile = path.join(localesDir, "status.json");
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const text = `${JSON.stringify(buildStatus(), null, 1)}\n`;
  if (process.argv.includes("--check")) {
    const saved = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
    if (saved !== text) {
      console.error("I18N_STATUS_OUT_OF_DATE: node scripts/i18n-status.mjs");
      process.exit(1);
    }
    console.log("I18N_STATUS_PASS");
  } else {
    fs.writeFileSync(outFile, text);
    console.log(`written ${path.relative(root, outFile)}`);
  }
}
