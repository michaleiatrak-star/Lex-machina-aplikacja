import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { AuthError } from "../src/auth/service.js";
import { sessionActivityMiddleware } from "../src/http/app.js";

function fixture() {
  const touchSession = vi.fn();
  const authService = {
    authenticateAuthorization: vi.fn((header: string | undefined) => {
      if (header !== "Bearer ok") throw new AuthError("AUTHENTICATION_REQUIRED", 401);
      return { session: { sessionId: "authsess_1" } } as never;
    }),
    touchSession
  };
  const app = express();
  app.use("/api", sessionActivityMiddleware(authService));
  // Druga warstwa (jak coreApp) nie dotyka sesji drugi raz w tym samym żądaniu.
  app.use("/api", sessionActivityMiddleware(authService));
  app.post("/api/cases/:caseId/workspace/folders", (_req, res) => res.json({ ok: true }));
  app.get("/api/cases/:caseId/workspace/folders", (_req, res) => res.json({ ok: true }));
  app.post("/api/auth/lock", (_req, res) => res.status(204).end());
  return { app, touchSession };
}

describe("session activity for routes registered in server.ts", () => {
  it("a state-changing request extends the session once", async () => {
    const { app, touchSession } = fixture();
    await request(app).post("/api/cases/c/workspace/folders").set("Authorization", "Bearer ok").expect(200);
    expect(touchSession).toHaveBeenCalledTimes(1);
    expect(touchSession).toHaveBeenCalledWith("authsess_1");
  });

  it("reads, lock and requests without a valid session do not touch it", async () => {
    const { app, touchSession } = fixture();
    await request(app).get("/api/cases/c/workspace/folders").set("Authorization", "Bearer ok").expect(200);
    await request(app).post("/api/auth/lock").set("Authorization", "Bearer ok").expect(204);
    await request(app).post("/api/cases/c/workspace/folders").set("Authorization", "Bearer zly").expect(200);
    expect(touchSession).not.toHaveBeenCalled();
  });
});
