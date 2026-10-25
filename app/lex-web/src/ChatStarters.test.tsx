import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CHAT_STARTERS, ChatStarters } from "./ChatStarters";

describe("ChatStarters", () => {
  it("offers the starting points as buttons that only fill the message box", () => {
    const html = renderToStaticMarkup(<ChatStarters onPick={() => undefined} />);
    for (const starter of CHAT_STARTERS) expect(html).toContain(`>${starter.label}</button>`);
    expect(html).not.toContain('type="submit"');
  });
});
