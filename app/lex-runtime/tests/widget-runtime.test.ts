import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { AuthError, type AuthService } from "../src/auth/service.js";
import { registerWidgetRoutes } from "../src/http/widget-routes.js";
import { LexSkillRegistry } from "../src/registry.js";
import {
  WIDGET_FRAME_CSP,
  WidgetFrameStore,
  WidgetToolRuntime,
  compileWidget,
  widgetFromFile,
  withWidgetData
} from "../src/widget-runtime.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-widgets-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const MENU = [
  "# WIDGET-MENU",
  "```jsx",
  'import { useState } from "react";',
  "export default function Menu() {",
  "  const [n, setN] = useState(0);",
  "  return <button onClick={() => { setN(n + 1); window.sendPrompt(\"start\"); }}>Uruchom {n}</button>;",
  "}",
  "```"
].join("\n");

function registry(): LexSkillRegistry {
  const skill = path.join(root, "audyt-systemu-v4");
  fs.mkdirSync(path.join(skill, "widgets"), { recursive: true });
  fs.writeFileSync(path.join(skill, "SKILL.md"), "---\nname: audyt-systemu-v4\ndescription: Audyt systemu\n---\n# Audyt\n");
  fs.writeFileSync(path.join(skill, "widgets", "WIDGET-MENU.md"), MENU);
  const result = new LexSkillRegistry(root);
  result.scan();
  return result;
}

describe("widgets", () => {
  it("extracts and compiles a JSX widget from a skill markdown file", () => {
    const widget = widgetFromFile("WIDGET-MENU.md", MENU);
    expect(widget.kind).toBe("jsx");
    const html = compileWidget({ title: "Menu", ...widget }, "a".repeat(32));
    expect(html).toContain("window.sendPrompt");
    expect(html).toContain("preact.render");
    expect(html).not.toMatch(/<script>[^]*<\/script[^>]*>[^]*import \{ useState \}/);
  });

  it("injects the bridge into an HTML widget head", () => {
    const html = compileWidget({ title: "T", kind: "html", code: "<html><head><title>x</title></head><body>ok</body></html>" }, "b".repeat(32));
    expect(html.indexOf("window.sendPrompt")).toBeLessThan(html.indexOf("<title>"));
  });

  it("does not take <header> inside a fragment for the document head", () => {
    const code = '<div id="r"></div><script>const h = () => `<header><h1>x</h1></header>`; document.getElementById("r").innerHTML = h();</script>';
    const html = compileWidget({ title: "T", kind: "html", code }, "c".repeat(32));
    expect(html).toContain("const h = () => `<header><h1>x</h1></header>`;");
    expect(html.indexOf("<head>")).toBeLessThan(html.indexOf("<header>"));
  });

  it("shows a corpus widget, rejects unknown paths and broken code", async () => {
    const tools = new WidgetToolRuntime(registry());
    const [shown, missing, escape, broken] = await tools.runTools([
      { id: "1", name: "show_widget", input: { title: "Audyt", path: "audyt-systemu-v4/widgets/WIDGET-MENU.md" } },
      { id: "2", name: "show_widget", input: { title: "x", path: "audyt-systemu-v4/widgets/BRAK.md" } },
      { id: "3", name: "show_widget", input: { title: "x", path: "../../etc/passwd" } },
      { id: "4", name: "show_widget", input: { title: "x", kind: "jsx", code: "export default () => <div>" } }
    ]);
    expect(JSON.parse(shown!.content)).toMatchObject({ status: "SHOWN", source: "audyt-systemu-v4/widgets/WIDGET-MENU.md" });
    expect(JSON.parse(missing!.content)).toMatchObject({ status: "BLOCKED", error: "WIDGET_FILE_NOT_FOUND" });
    expect(JSON.parse(escape!.content).status).toBe("BLOCKED");
    expect(JSON.parse(broken!.content).error).toMatch(/^WIDGET_COMPILE_FAILED/);
    expect(tools.widgets()).toEqual([
      expect.objectContaining({ title: "Audyt", kind: "jsx", source: "audyt-systemu-v4/widgets/WIDGET-MENU.md" })
    ]);
  });

  it("serves a registered frame by capability id with its own CSP", async () => {
    const authService = {
      authenticateAuthorization(header: string | undefined) {
        if (header !== "Bearer alice") throw new AuthError("AUTHENTICATION_REQUIRED", 401);
        return { user: { userId: "user_alice" } };
      }
    } as unknown as AuthService;
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    registerWidgetRoutes(app, { authService, frames: new WidgetFrameStore() });
    const widget = { title: "Menu", kind: "html", code: "<p>Widget</p>" };
    await request(app).post("/api/widgets").send({ widget }).expect(401);
    await request(app).post("/api/widgets").set("authorization", "Bearer alice").send({ widget: { kind: "pdf", code: "x" } }).expect(400);
    const created = await request(app).post("/api/widgets").set("authorization", "Bearer alice").send({ widget }).expect(200);
    expect(created.body.widgetId).toMatch(/^[0-9a-f]{32}$/);
    const frame = await request(app).get(`/api/widgets/frame/${created.body.widgetId}`).expect(200);
    expect(frame.headers["content-security-policy"]).toBe(WIDGET_FRAME_CSP);
    expect(WIDGET_FRAME_CSP).toContain("default-src 'none'");
    expect(frame.text).toContain("<p>Widget</p>");
    await request(app).get(`/api/widgets/frame/${"0".repeat(32)}`).expect(404);
  });
});

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");

function scripts(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]!);
}

describe("corpus templates fed with data", () => {
  const template = [
    "<body><div id=x></div><script>",
    'const SAMPLE_DATA = /* lex:dane */ { a: "}{ \\" ]", b: [1, 2], c: { d: `x}` } /* } */ };',
    "document.getElementById('x').textContent = SAMPLE_DATA.a;",
    "</script></body>"
  ].join("\n");

  it("replaces the marked literal with the model's data and adds the export/import bar", () => {
    const code = withWidgetData({ kind: "html", code: template }, { a: "</script><b>", rows: [{ k: 1 }] }, "chronologia-sprawy-v1");
    expect(code).toContain("const SAMPLE_DATA = /* lex:dane */ (window.__lexData||window.__lexDefault);");
    expect(code).not.toContain("b: [1, 2]");
    expect(code).toContain('window.__lexDefault={"a":"\\u003c/script>\\u003cb>","rows":[{"k":1}]}');
    expect(code.indexOf('id="lex-io"')).toBeGreaterThan(code.indexOf("<body>"));
    for (const script of scripts(compileWidget({ title: "T", kind: "html", code }, "c".repeat(32)))) expect(() => new Function(script)).not.toThrow();
  });

  it("no data (null): the template's empty literal stays the default, an import still wins", () => {
    const code = withWidgetData({ kind: "html", code: template }, null, "chronologia-sprawy-v1");
    expect(code).toContain('const SAMPLE_DATA = /* lex:dane */ (window.__lexData||{ a: "}{ \\" ]", b: [1, 2], c: { d: `x}` } /* } */ });');
    expect(code).not.toContain("window.__lexDefault=");
    expect(code).toContain('id="lex-io"');
  });

  it("a widget prompt needs the user's own click (no prompt from an injected handler)", () => {
    const html = compileWidget({ title: "T", kind: "html", code: "<div></div>" }, "d".repeat(32));
    expect(html).toContain("navigator.userActivation&&!navigator.userActivation.isActive");
  });

  it("refuses a template without a data slot and oversized data", () => {
    expect(() => withWidgetData({ kind: "html", code: "<div></div>" }, {}, "x")).toThrow("WIDGET_TEMPLATE_HAS_NO_DATA_SLOT");
    const mentioned = withWidgetData({ kind: "html", code: `<!-- slot: /* lex:dane */ -->\n${template}` }, { a: 1 }, "x");
    expect(mentioned).toContain("<!-- slot: /* lex:dane */ -->");
    expect(mentioned).toContain("const SAMPLE_DATA = /* lex:dane */ (window.__lexData");
    expect(() => withWidgetData({ kind: "html", code: template }, { a: "x".repeat(200_001) }, "x")).toThrow("WIDGET_DATA_TOO_LARGE");
  });

  it("shows the chronology timeline from data only; the causal graph keeps its own bar", async () => {
    const registry = new LexSkillRegistry(CORPUS);
    registry.scan();
    const tools = new WidgetToolRuntime(registry);
    const data = { watki: [{ id: "W1", nazwa: "Najem" }], zdarzenia: [], finanse: [], sprzecznosci: [] };
    const [timeline, graph] = await tools.runTools([
      { id: "1", name: "show_widget", input: { title: "Oś czasu", path: "chronologia-sprawy-v1/assets/widget-timeline.html", data } },
      { id: "2", name: "show_widget", input: { title: "Graf", path: "chronologia-sprawy-v1/assets/widget-graf-przyczynowy.html", data: { teza: "T", wezly: [], krawedzie: [] } } }
    ]);
    expect(JSON.parse(timeline!.content).status).toBe("SHOWN");
    expect(JSON.parse(graph!.content).status).toBe("SHOWN");
    const [shownTimeline, shownGraph] = tools.widgets();
    expect(shownTimeline!.code).toContain('"nazwa":"Najem"');
    expect(shownTimeline!.code).toContain('id="lex-io"');
    expect(shownGraph!.code).not.toContain('id="lex-io"');
    expect(shownGraph!.code).toContain("let GRAF = /* lex:dane */ (window.__lexData||window.__lexDefault);");
  });

  it("renders the case-law widget from data: text only, http(s) links, the app's export bar", async () => {
    const registry = new LexSkillRegistry(CORPUS);
    registry.scan();
    const tools = new WidgetToolRuntime(registry);
    const data = {
      tytul: "<b>x</b>",
      etap: "wynik",
      orzeczenia: [{ sygnatura: "III CZP 1/20", kategoria: "6A", url: "javascript:alert(1)", alerty: [] }]
    };
    const [result] = await tools.runTools([
      { id: "1", name: "show_widget", input: { title: "Orzeczenia", path: "orzeczenia-sadowe-v2/assets/widget-orzeczenia.html", data } }
    ]);
    expect(JSON.parse(result!.content).status).toBe("SHOWN");
    const code = tools.widgets()[0]!.code;
    expect(code).toContain('id="lex-io"');
    expect(code).toContain('"tytul":"\\u003cb>x\\u003c/b>"');
    expect(code).not.toMatch(/innerHTML\s*=/u);
    for (const script of scripts(compileWidget({ title: "T", kind: "html", code }, "d".repeat(32)))) expect(() => new Function(script)).not.toThrow();
  });

  it("provision analysis: the selection form needs no data, the results take data", async () => {
    const registry = new LexSkillRegistry(CORPUS);
    registry.scan();
    const tools = new WidgetToolRuntime(registry);
    const [form, results] = await tools.runTools([
      { id: "1", name: "show_widget", input: { title: "Wybór", path: "analizator-przepisow-v2/assets/widget-wybor-przepisu.html" } },
      {
        id: "2",
        name: "show_widget",
        input: {
          title: "Wyniki",
          path: "analizator-przepisow-v2/assets/widget-wyniki.html",
          data: { przepis: { oznaczenie: "art. 415 KC" }, przeslanki: { logika: "AND", lista: [{ id: "P1", nazwa: "szkoda", status: "T", pewnosc: 90 }] } }
        }
      }
    ]);
    expect(JSON.parse(form!.content).status).toBe("SHOWN");
    expect(JSON.parse(results!.content).status).toBe("SHOWN");
    const [shownForm, shownResults] = tools.widgets();
    expect(shownForm!.code).toContain("window.sendPrompt");
    expect(shownResults!.code).toContain('"oznaczenie":"art. 415 KC"');
    for (const widget of tools.widgets()) for (const script of scripts(compileWidget(widget, "e".repeat(32)))) expect(() => new Function(script)).not.toThrow();
  });
});

