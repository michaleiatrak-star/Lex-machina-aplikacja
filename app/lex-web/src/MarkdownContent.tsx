import type { ReactNode } from "react";

/**
 * Markdown of a model answer: pipe tables, headings, lists, bold, italics,
 * inline code and rules. No HTML from the answer is interpreted; plain text
 * pieces go to renderText (links, citation markers).
 */
export type RenderText = (text: string, key: string) => ReactNode;

export type MarkdownBlock =
  | { type: "paragraph"; lines: string[] }
  | { type: "heading"; level: number; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; header: string[]; align: Array<"left" | "center" | "right" | null>; rows: string[][] }
  | { type: "rule" };

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

const tableLine = (line: string): boolean => line.trim().startsWith("|") || /\S\s*\|\s*\S/.test(line);

// Cells of a row; text after the closing pipe (a verification marker the
// model put after the row) joins the last cell instead of being lost.
export function tableCells(line: string, columns?: number): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  const cells = text.split("|").map((cell) => cell.trim());
  if (cells.length > 1 && cells.at(-1) === "") cells.pop();
  if (columns && cells.length > columns) {
    const extra = cells.splice(columns - 1).filter(Boolean).join(" ");
    cells.push(extra);
  }
  while (columns && cells.length < columns) cells.push("");
  return cells;
}

export function parseMarkdown(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", lines: paragraph });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const next = lines[index + 1];
    if (tableLine(line) && next !== undefined && TABLE_SEPARATOR.test(next) && next.includes("-")) {
      flush();
      const header = tableCells(line);
      const align = tableCells(next, header.length).map((cell) =>
        cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : null
      );
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index]!.trim() && tableLine(lines[index]!)) {
        rows.push(tableCells(lines[index]!, header.length));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "table", header, align, rows });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1]!.length, text: heading[2]! });
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ type: "rule" });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = Boolean(numbered);
      const items = [(bullet ?? numbered)![1]!];
      while (index + 1 < lines.length) {
        const following = lines[index + 1]!;
        const item = (ordered ? NUMBERED : BULLET).exec(following);
        if (item) {
          items.push(item[1]!);
        } else if (/^\s{2,}\S/.test(following) && !BULLET.test(following) && !NUMBERED.test(following)) {
          // Continuation of the previous item.
          items[items.length - 1] += `\n${following.trim()}`;
        } else {
          break;
        }
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

// **bold**, __bold__, *italic*, `code`; everything else goes to renderText.
function inline(text: string, renderText: RenderText, key: string): ReactNode[] {
  const pattern = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|(?<![\w*])\*[^*\s][^*\n]*?\*(?![\w*]))/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let part = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(renderText(text.slice(cursor, match.index), `${key}-t${part++}`));
    const token = match[0];
    const id = `${key}-m${part++}`;
    if (token.startsWith("`")) nodes.push(<code key={id}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("**") || token.startsWith("__")) nodes.push(<strong key={id}>{inline(token.slice(2, -2), renderText, id)}</strong>);
    else nodes.push(<em key={id}>{inline(token.slice(1, -1), renderText, id)}</em>);
    cursor = match.index + token.length;
  }
  if (cursor < text.length) nodes.push(renderText(text.slice(cursor), `${key}-t${part}`));
  return nodes;
}

function lines(text: string, renderText: RenderText, key: string): ReactNode[] {
  return text.split("\n").flatMap((line, index) => [
    ...(index ? [<br key={`${key}-br${index}`} />] : []),
    ...inline(line, renderText, `${key}-l${index}`)
  ]);
}

export function MarkdownContent({ content, renderText }: { content: string; renderText: RenderText }) {
  return (
    <>
      {parseMarkdown(content).map((block, index) => {
        const key = `b${index}`;
        switch (block.type) {
          case "heading": {
            const Tag = (["h3", "h3", "h4", "h5", "h6", "h6"] as const)[block.level - 1]!;
            return <Tag key={key} className="chat-md-heading">{inline(block.text, renderText, key)}</Tag>;
          }
          case "rule":
            return <hr key={key} />;
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List key={key} className="chat-md-list">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>{lines(item, renderText, `${key}-${itemIndex}`)}</li>
                ))}
              </List>
            );
          }
          case "table":
            return (
              <div key={key} className="chat-md-table-wrap">
                <table className="chat-md-table">
                  <thead>
                    <tr>
                      {block.header.map((cell, cellIndex) => (
                        <th key={cellIndex} style={block.align[cellIndex] ? { textAlign: block.align[cellIndex]! } : undefined}>
                          {inline(cell, renderText, `${key}-h${cellIndex}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} style={block.align[cellIndex] ? { textAlign: block.align[cellIndex]! } : undefined}>
                            {inline(cell, renderText, `${key}-${rowIndex}-${cellIndex}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return <p key={key} className="chat-md-paragraph">{lines(block.lines.join("\n"), renderText, key)}</p>;
        }
      })}
    </>
  );
}
