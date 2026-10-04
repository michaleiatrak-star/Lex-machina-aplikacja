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
  widgetFromFile
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
