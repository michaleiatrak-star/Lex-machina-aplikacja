import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createLexHttpApp, jsonErrorHandler } from "../src/http/app.js";

describe("final HTTP error handler", () => {
  it("answers a malformed JSON body with a JSON code, not a stack trace", async () => {
    const app = createLexHttpApp({ modelCatalog: { list: vi.fn(async () => []) } } as never);
    const response = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send("{\"loginName\":");
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "INVALID_JSON_BODY" });
    expect(response.text).not.toMatch(/at |node_modules|\/src\//);
  });

  it("hides an unexpected exception behind INTERNAL_ERROR and logs it server-side", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = express();
    app.get("/boom", () => {
      throw new Error("ENOENT: no such file, open '/home/user/tajne/sprawa.json'");
    });
    app.use(jsonErrorHandler);
    const response = await request(app).get("/boom");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "INTERNAL_ERROR" });
    expect(response.text).not.toContain("tajne");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
