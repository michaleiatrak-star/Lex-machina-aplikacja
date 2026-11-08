/**
 * The name of an individual user's conversation, from their first question: no greeting, the
 * first sentence or question, cut at a word, capitalised ("Hej, ile wynosi w tym roku wartość
 * mienia przy wykroczeniu?" -> "Ile wynosi w tym roku wartość mienia przy wykroczeniu?").
 */
const GREETING =
  /^(?:(?:hej|cześć|czesc|witam|witaj|dzień dobry|dzien dobry|dobry wieczór|dobry wieczor|siema|halo|hello|hi)\b[\s,!.:-]*)+/iu;
const MAX = 60;

export function conversationTitle(question: string): string {
  const text = question.replace(/\s+/gu, " ").trim().replace(GREETING, "").trim();
  if (text.length < 3) return "Nowa rozmowa";
  const sentence = /^(.+?[?!.])(?:\s|$)/u.exec(text)?.[1] ?? text;
  let title = sentence.length <= MAX ? sentence : sentence.slice(0, MAX).replace(/\s+\S*$/u, "") + "…";
  title = title.replace(/^[„"'(]+/u, "");
  return title.charAt(0).toLocaleUpperCase("pl") + title.slice(1);
}
