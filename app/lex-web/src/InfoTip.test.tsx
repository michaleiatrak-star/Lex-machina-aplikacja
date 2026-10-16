import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InfoTip } from "./InfoTip";

describe("InfoTip", () => {
  it("keeps the explanation for screen readers and in a bubble, out of the layout", () => {
    const html = renderToStaticMarkup(<InfoTip>Plik trafia do modelu tylko w wersji z symbolami.</InfoTip>);
    expect(html).toContain('role="tooltip"');
    expect(html).toMatch(/aria-describedby="([^"]+)"[^>]*>i<\/button><span role="tooltip" id="\1"/u);
    expect(html).toContain("Plik trafia do modelu tylko w wersji z symbolami.");
  });
});
