import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceLinkedText } from "./SourceLinkedText.js";

describe("SourceLinkedText", () => {
  it("renders normal HTTPS markdown sources as active links", () => {
    const html = renderToStaticMarkup(
      <SourceLinkedText content={"[Akt prawny](https://api.sejm.gov.pl/eli/acts/DU/1997/553/text.html)"} />
    );
    expect(html).toContain('href="https://api.sejm.gov.pl/eli/acts/DU/1997/553/text.html"');
    expect(html).toContain(">Akt prawny</a>");
  });

  it("repairs the escaped nested link form emitted by an account model", () => {
    const html = renderToStaticMarkup(
      <SourceLinkedText
        content={"[Orzeczenie]\\([https://sn.pl/case](https://sn.pl/case))"}
      />
    );
    expect(html).toContain('href="https://sn.pl/case"');
    expect(html).toContain(">Orzeczenie</a>");
  });

  it("shows a VER marker with a short act label and the full address in the tooltip", () => {
    const url = "https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf#page=54";
    const html = renderToStaticMarkup(
      <SourceLinkedText content={`Kłamstwo w zeznaniach. ✅ [VER: ${url}, 2026-10-05]`} />
    );
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain(">Dz.U. 2025 poz. 383, s. 54</a>");
    expect(html).toContain(">2026-10-05</span>]");
    expect(html).not.toContain(`>${url}<`);
  });

  it("labels a VER link with the provision cited before it, not the whole address", () => {
    const page55 = "https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf#page=55";
    const sources = [
      { claim: "art. 234 KK", url: page55 },
      { claim: "art. 238 KK", url: page55 }
    ];
    const html = renderToStaticMarkup(
      <SourceLinkedText
        before="**Art. 238 KK**"
        content={` – fałszywe zawiadomienie. ✅ [VER: ${page55}, 2026-10-05]`}
        sources={sources}
      />
    );
    expect(html).toContain(">art. 238 KK</a>");
    expect(html).toContain("Dz.U. 2025 poz. 383, s. 55");
  });

  it("shows a bare address as a short site name", () => {
    const html = renderToStaticMarkup(<SourceLinkedText content={"Zob. https://www.sn.pl/orzecznictwo/SitePages/x.aspx"} />);
    expect(html).toContain(">sn.pl</a>");
    expect(html).toContain('title="https://www.sn.pl/orzecznictwo/SitePages/x.aspx"');
  });

  it("does not activate non-HTTPS text", () => {
    const html = renderToStaticMarkup(
      <SourceLinkedText content={"http://example.com/source"} />
    );
    expect(html).not.toContain("<a");
    expect(html).toContain("http://example.com/source");
  });
  it("links a verified provision named in the text to the page of the cited article", () => {
    const pdf = "https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf";
    const sources = [
      { claim: "art. 233 KK", url: pdf },
      { claim: "art. 233 KK", url: `${pdf}#page=97` },
      { claim: "art. 238 KK", url: `${pdf}#page=99` }
    ];
    const html = renderToStaticMarkup(
      <SourceLinkedText
        content={"Art. 233 § 1 KK dotyczy zeznań, art. 238 k.k. zawiadomienia, a art. 234 KK nie był sprawdzony."}
        sources={sources}
      />
    );
    expect(html).toContain(`href="${pdf}#page=97"`);
    expect(html).toContain(">Art. 233 § 1 KK</a>");
    expect(html).toContain(`href="${pdf}#page=99"`);
    expect(html).toContain(">art. 238 k.k.</a>");
    expect(html).not.toContain(">art. 234 KK</a>");
  });

  it("does not link a provision of another act with the same number", () => {
    const html = renderToStaticMarkup(
      <SourceLinkedText
        content={"Art. 233 KPC dotyczy oceny dowodów."}
        sources={[{ claim: "art. 233 KK", url: "https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf#page=97" }]}
      />
    );
    expect(html).not.toContain("<a");
  });
});
