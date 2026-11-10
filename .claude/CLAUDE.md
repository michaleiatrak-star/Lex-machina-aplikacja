## Core Principles

- Never use emojis.

## Commit Authorship

When committing code changes:
- Never add Claude as a commit author.
- Always commit as using the default git settings

## Documentation Style

When creating or updating markdown documentation files:
- **Never create .md documentation files (README, reports, summaries) unless explicitly instructed.** This rule does not apply to skill content: SKILL.md, modules and references inside skill directories are code and may be created/edited as the task requires.
- **Be extremely concise** - engineers scan, they don't read novels
- **Only include essential information** - what they need to know, not what's possible to explain
- **Prefer examples over prose** - show the pattern, not the theory
- **Assume technical competence** - skip obvious explanations
- **Front-load critical info** - put warnings and key concepts first
- **Delete verbose explanations** - if it takes more than 3 sentences, it's probably too long

Default to 1-2 sentence explanations. Only expand when complexity absolutely requires it.
## Interface (lex-web)

Before a UI change is done, check it against these rules. If unsure, consult expert sources (NN/g, Atlassian/Carbon design systems, WAI-ARIA APG), never memory.
- Edit in place, no duplicate form blocks: pencil next to the value, then `InlineEdit` (field + ✓ save + ✕ cancel; Enter or blur saves, Esc cancels).
- Case card sections (schedule, contacts, documents): one compact row each (name, count, "Pokaż", "+ Dodaj"); the list and the add form open in a modal (`CollapsibleCaseSection`).
- Lists: filters in one block (search, person, sort, date-range presets + custom), result count, "select all visible" with a partial state, bulk actions only while something is selected, selection limited to visible items.
- Polish UI text only (no English jargon: runtime, backend, pipeline, checkpoint, chunk, provider). Every shown text goes through `t()`/`N_()`; run `node scripts/i18n-status.mjs`.
- Verify visually (Playwright screenshot with mocked API) before reporting done.
