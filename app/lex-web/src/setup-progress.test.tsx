import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ComponentSetupView } from "./ComponentSetup.js";
import { downloadDescription } from "./ApplicationDownloadProgress.js";
describe("plain language preparation", () => {
  it("offers retry after failure and completion only after success", () => {
    const render = (phase: "running" | "failed" | "done") => renderToStaticMarkup(<ComponentSetupView value={{ phase }} error="" onStart={() => {}} onFinish={() => {}} />);
    expect(render("failed")).toContain("Spróbuj ponownie");
    expect(render("failed")).not.toContain("Otwórz Lex Machina");
    expect(render("running")).toContain("progress");
    expect(render("done")).toContain("Otwórz Lex Machina");
    expect(render("running")).not.toMatch(/Python|SHA-256|runtime|bootstrap/);
  });
  it("shows honest progress when the total size is unknown", () => {
    expect(downloadDescription({ phase: "downloading", received: 1048576 })).toBe("Pobieram aktualizację: 1 MB");
    expect(downloadDescription({ phase: "downloading", received: 1048576, total: 2097152 })).toBe("Pobieram aktualizację: 1 z 2 MB");
    expect(downloadDescription({ phase: "checking", received: 0 })).toBe("Sprawdzam pobrane pliki…");
  });
});
