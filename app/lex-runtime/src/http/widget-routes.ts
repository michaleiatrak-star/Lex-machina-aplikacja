import type { Express, Request, Response } from "express";
import { AuthError, type AuthService } from "../auth/service.js";
import { WIDGET_FRAME_CSP, WidgetError, type WidgetFrameStore } from "../widget-runtime.js";

// Widgety w czacie: rejestracja (zalogowany użytkownik) zwraca identyfikator ramki;
// ramka jest dostępna pod adresem-kluczem (128 bitów, 2 h), bo nawigacja iframe nie
// niesie nagłówka Authorization. Treść ramki ma własne CSP: bez sieci i bez formularzy.
export function registerWidgetRoutes(
  app: Express,
  options: { authService: AuthService; frames: WidgetFrameStore }
): void {
  const { authService, frames } = options;

  app.post("/api/widgets", (req: Request, res: Response) => {
    let userId: string;
    try {
      userId = authService.authenticateAuthorization(req.get("authorization")).user.userId;
    } catch (error) {
      res
        .status(error instanceof AuthError ? error.httpStatus : 401)
        .json({ error: error instanceof AuthError ? error.code : "AUTHENTICATION_REQUIRED" });
      return;
    }
    try {
      res.json({ widgetId: frames.register(userId, req.body?.widget) });
    } catch (error) {
      res.status(400).json({ error: error instanceof WidgetError ? error.code : "WIDGET_INVALID" });
    }
  });

  app.get("/api/widgets/frame/:widgetId", (req: Request, res: Response) => {
    const html = frames.frame(String(req.params.widgetId ?? ""));
    res.removeHeader("X-Frame-Options");
    res.setHeader("Content-Security-Policy", WIDGET_FRAME_CSP);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (!html) {
      res.status(404).type("text/plain").send("Widget wygasł. Otwórz go ponownie z wiadomości w czacie.");
      return;
    }
    res.status(200).type("text/html; charset=utf-8").send(html);
  });
}
