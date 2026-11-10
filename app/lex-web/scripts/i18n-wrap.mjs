// Passes the Polish texts a component shows through t() (codemod; review the diff):
//   node scripts/i18n-wrap.mjs src/AuthApp.tsx [more files]
// Wrapped: JSX text, shown attributes (title, placeholder, aria-label, alt, label), messages given
// to state setters / confirm / alert, label-like object properties and returns of *Label/*Message
// functions. Texts at module level get N_() (translated where shown). Left alone and listed:
// template literals with substitutions (they need t("... {name}", { name }) by hand).
import fs from "node:fs";
import ts from "typescript";

const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]|\b(?:i|w|z|na|do|nie|się|jest|oraz|lub|dla|przez|od|po|to|czy|jak|ten|ta)\b/iu;
const SHOWN_ATTRIBUTES = new Set(["title", "placeholder", "aria-label", "alt", "label", "aria-description"]);
const LABEL_PROPERTIES = new Set(["label", "title", "description", "help", "hint", "text", "message", "placeholder", "summary", "detail", "note", "caption", "heading", "empty", "tooltip"]);
const KEEP_AS_IS = new Set(["Lex Machina", "admin", "ELI", "SAOS", "ISAP", "CBOSA", "KRS", "OK"]);

function shownText(text) {
  const core = text.replace(/\s+/gu, " ").trim();
  if (!/\p{L}{2,}/u.test(core)) return null;
  if (KEEP_AS_IS.has(core)) return null;
  if (/^[A-Z0-9 .·\-/_:]+$/u.test(core)) return null;
  return core;
}

function quote(text) {
  return JSON.stringify(text);
}

function insideFunction(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionLike(parent)) return true;
  }
  return false;
}

function enclosingFunctionName(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) && parent.name) return parent.name.text;
    if ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) && ts.isVariableDeclaration(parent.parent) && ts.isIdentifier(parent.parent.name)) {
      return parent.parent.name.text;
    }
  }
  return "";
}

function isComparisonOrKey(node) {
  const parent = node.parent;
  if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(parent.operatorToken.kind)) return true;
  if (ts.isCaseClause(parent) || ts.isLiteralTypeNode(parent) || ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isElementAccessExpression(parent)) return true;
  return false;
}

/** Whether a string literal (not in JSX attributes) is a text the user reads. */
function shownLiteral(node) {
  if (isComparisonOrKey(node)) return false;
  let current = node;
  // Through conditional branches, parentheses and ?? / || defaults.
  while (
    ts.isParenthesizedExpression(current.parent) ||
    (ts.isConditionalExpression(current.parent) && current.parent.condition !== current) ||
    (ts.isBinaryExpression(current.parent) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(current.parent.operatorToken.kind) && current.parent.right === current)
  ) {
    current = current.parent;
  }
  const parent = current.parent;
  if (ts.isJsxExpression(parent)) return !ts.isJsxAttribute(parent.parent) || SHOWN_ATTRIBUTES.has(parent.parent.name.getText());
  if (ts.isCallExpression(parent) && parent.arguments.includes(current)) {
    const callee = parent.expression.getText();
    return /^set[A-Z]\w*$/u.test(callee) || /(^|\.)(confirm|alert|prompt)$/u.test(callee) || /^(setError|setNotice|setMessage|showError|notify)$/u.test(callee);
  }
  if (ts.isPropertyAssignment(parent) && parent.initializer === current) {
    const name = parent.name.getText().replace(/["']/gu, "");
    return LABEL_PROPERTIES.has(name);
  }
  if (ts.isReturnStatement(parent)) return /(Label|Message|Text|Title|Description|Hint|Help)$/u.test(enclosingFunctionName(current));
  return false;
}

export function wrapFile(file) {
  const code = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  const templates = [];
  let usesT = false;
  let usesN = false;
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === "t" || node.expression.text === "N_")) return;
    if (ts.isJsxText(node)) {
      const core = shownText(node.text);
      if (core && POLISH.test(node.text) || (core && /[a-ząćęłńóśźż]{3,}/u.test(core))) {
        const raw = node.text;
        const start = node.pos;
        const lead = raw.match(/^\s*/u)[0].length;
        const trail = raw.match(/\s*$/u)[0].length;
        edits.push({ start: start + lead, end: start + raw.length - trail, text: `{t(${quote(core)})}` });
        usesT = true;
      }
    } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText(sourceFile);
      const core = shownText(node.initializer.text);
      if (SHOWN_ATTRIBUTES.has(name) && core) {
        edits.push({ start: node.initializer.getStart(sourceFile), end: node.initializer.getEnd(), text: `{t(${quote(node.initializer.text)})}` });
        usesT = true;
      }
      return;
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && POLISH.test(node.text) && /\s/u.test(node.text) && shownLiteral(node)) {
      const inside = insideFunction(node);
      edits.push({ start: node.getStart(sourceFile), end: node.getEnd(), text: `${inside ? "t" : "N_"}(${quote(node.text)})` });
      if (inside) usesT = true;
      else usesN = true;
    } else if (ts.isTemplateExpression(node) && POLISH.test(node.getText(sourceFile))) {
      templates.push(`${file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1} ${node.getText(sourceFile).slice(0, 90)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!edits.length) return { file, edits: 0, templates };
  let out = code;
  for (const edit of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  const names = [usesT && "t", usesN && "N_"].filter(Boolean);
  const existing = /import \{([^}]*)\} from "\.\/i18n(?:\.js)?";/u.exec(out);
  if (existing) {
    const have = new Set(existing[1].split(",").map((name) => name.trim()).filter(Boolean));
    for (const name of names) have.add(name);
    out = out.replace(existing[0], `import { ${[...have].join(", ")} } from "./i18n";`);
  } else {
    out = `import { ${names.join(", ")} } from "./i18n";\n${out}`;
  }
  fs.writeFileSync(file, out);
  return { file, edits: edits.length, templates };
}

if (process.argv[1] && process.argv[1].endsWith("i18n-wrap.mjs")) {
  for (const file of process.argv.slice(2)) {
    const result = wrapFile(file);
    console.log(`${result.file}: ${result.edits} texts`);
    for (const line of result.templates) console.log(`  TEMPLATE (by hand): ${line}`);
  }
}
