import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownContent, parseMarkdown, tableCells } from "./MarkdownContent.js";

const plain = (text: string, key: string) => <span key={key}>{text}</span>;

describe("answer markdown", () => {
  it("draws a table and keeps a marker written after the closing pipe in the last cell", () => {
    const answer = [
      "| Przepis | Istota czynu | Kara |",
      "|---|---|---|",
      "| **Art. 233 KK** | Fałszywe zeznanie | 6 miesięcy–8 lat | ✅ [VER: https://api.sejm.gov.pl/x#page=54, 2026-10-03]",
      "| **Art. 238 KK** | Fikcyjne przestępstwo | do 2 lat |"
    ].join("\n");
    const [table] = parseMarkdown(answer);
    expect(table).toMatchObject({ type: "table", header: ["Przepis", "Istota czynu", "Kara"] });
    expect(table!.type === "table" && table!.rows[0]![2]).toBe("6 miesięcy–8 lat ✅ [VER: https://api.sejm.gov.pl/x#page=54, 2026-10-03]");
    const html = renderToStaticMarkup(<MarkdownContent content={answer} renderText={plain} />);
    expect(html).toContain("<table");
    expect(html).toContain("<strong><span>Art. 233 KK</span></strong>");
    expect(html).toContain("VER: https://api.sejm.gov.pl/x#page=54");
    expect(html).not.toContain("|");
  });

  it("renders headings, lists and paragraphs without interpreting HTML", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        content={"## Wnioski\n- **233 KK** — zeznania;\n- 238 KK\n\n1. pierwszy\n2. drugi\n\nTekst <b>nie</b> jest HTML."}
        renderText={plain}
      />
    );
    expect(html).toContain("<h3");
    expect(html).toContain("<ul");
    expect(html).toContain("<ol");
    expect(html).toContain("&lt;b&gt;nie&lt;/b&gt;");
  });

  it("pads short rows and does not mistake a pipe in prose for a table", () => {
    expect(tableCells("| a |", 3)).toEqual(["a", "", ""]);
    expect(parseMarkdown("Wybierz A | B, zależnie od sprawy.")[0]!.type).toBe("paragraph");
  });
});
