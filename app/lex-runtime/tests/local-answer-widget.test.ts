import { describe, expect, it } from "vitest";
import { withOneClosingDisclaimer } from "../src/session-executor.js";
import { widgetsFromAnswer } from "../src/widget-runtime.js";

const ANSWER = [
  "Widget: aktualne brzmienie art. 276 Kodeksu karnego",
  "```html",
  "<section>",
  "  <h2>Art. 276 Kodeksu karnego</h2>",
  "  <p>Kto niszczy, uszkadza, czyni bezużytecznym, ukrywa lub usuwa dokument, ... pozbawienia wolności do lat 2.</p>",
  "</section>",
  "```",
  "Wniosek praktyczny",
  "⚖️ To wyjaśnienie ma charakter informacyjny i edukacyjny.",
  "⚖️ Ważna informacja: Niniejsza analiza ma charakter wyłącznie informacyjny",
  "i edukacyjny."
].join("\n");

describe("a local model's widget and closing note (statute analyzer; ChatGPT without show_widget, local model)", () => {
  it("shows the HTML block as a widget, out of the text the gates mark", () => {
    const { text, widgets } = widgetsFromAnswer(ANSWER);
    expect(widgets).toHaveLength(1);
    expect(widgets[0]).toMatchObject({ kind: "html", title: "Widget: aktualne brzmienie art. 276 Kodeksu karnego" });
    expect(widgets[0]!.code).toContain("<h2>Art. 276 Kodeksu karnego</h2>");
    expect(text).not.toContain("<section>");
    expect(text).toContain("[Widget „Widget: aktualne brzmienie art. 276 Kodeksu karnego” — wyświetlony w oknie widgetu]");
    expect(widgetsFromAnswer("```html\nzwykły tekst\n```").widgets).toHaveLength(0);
  });

  it("keeps one disclaimer, the full one", () => {
    const text = withOneClosingDisclaimer(ANSWER);
    expect(text).not.toContain("To wyjaśnienie");
    expect(text).toContain("⚖️ Ważna informacja: Niniejsza analiza ma charakter wyłącznie informacyjny\ni edukacyjny.");
    expect(withOneClosingDisclaimer("Tekst\n⚖️ Jedna")).toBe("Tekst\n⚖️ Jedna");
  });
});
