import { describe, expect, it } from "vitest";

const files = import.meta.glob("./*.css", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

// Themes (theme.css) recompute role tokens; a colour written directly in a stylesheet
// would not follow them (a light island in the night theme).
describe("colour themes", () => {
  const sheets = Object.keys(files).filter((name) => name !== "./theme.css");

  it("stylesheets use the theme tokens, not colour literals", () => {
    expect(sheets.length).toBeGreaterThan(5);
    const literals = sheets.flatMap((name) =>
      files[name]!.split("\n")
        .map((line, index) => ({ name, line: index + 1, text: line }))
        .filter(({ text }) => !text.trim().startsWith("/*") && /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/u.test(text))
    );
    expect(literals).toEqual([]);
  });

  it("every theme defines every token used", () => {
    const theme = files["./theme.css"]!;
    const used = new Set(sheets.flatMap((name) => [...files[name]!.matchAll(/var\((--lm-[a-z]\d+(?:-rgb)?)\)/gu)].map((match) => match[1]!)));
    const blocks = theme.split(/\n(?=\S|  :root)/u).filter((block) => block.includes("{"));
    for (const selector of [':root {', ':root[data-theme="night"]', ':root[data-theme="neutral"]', ':root[data-theme="contrast"]', ':root[data-theme="system"]']) {
      const block = blocks.find((item) => item.includes(selector)) ?? "";
      for (const token of used) expect(block, `${selector} ${token}`).toContain(`${token}:`);
    }
  });
});
