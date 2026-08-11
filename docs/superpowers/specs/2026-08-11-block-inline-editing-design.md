# Markion Block Inline-Editing Design

**Date:** 2026-08-11
**Status:** Draft
**Supersedes:** the "cursor flips whole block to source" behavior for code/table blocks (kept for image/math).

## Problem

In live-preview edit mode, clicking a rendered block (code, table, image, math) currently flips the **entire block** to raw source. For code/tables the flip is mildly jarring but workable; for images/math the rendered↔source gap is huge and the flip is deeply jarring.

Goal: a **layered interaction** where each block type uses the least-disruptive editing affordance:

- **Code block** — edit **in place** (rendered look, editable text), no full flip.
- **Table** — edit **in the rendered grid**, each cell editable; formats preserved via a hidden source layer.
- **Image / Math** — stay rendered; a **persistent corner badge** ("source") flips that block to source for editing.
- **Task list** — already toggles in place (unchanged).

## Approach

### A. Code block: edit-in-place `contenteditable`

`CodeBlockWidget.toDOM` renders the code as before (language tag + highlighted `<code>`), but the `<code>` becomes `contenteditable`. The widget holds the **source text** (the code lines). On edit:

```
contenteditable input → debounce 300ms
  → read textContent (pure code text)
  → view.dispatch({ changes: { from: block.from, to: block.to, insert: "```"+lang+"\n"+text+"\n```" } })
  → CM6 updates doc → decorations rebuild → new widget
```

- Rendered look preserved (monospace, language label, highlight classes stay).
- The widget itself carries the live source; no reverse-parse from DOM.
- Debounce coalesces keystrokes into one CM6 transaction → one undo step.
- `ignoreEvent` returns `false` for mousedown/mouseup/click so the block stays clickable; text editing happens inside `contenteditable`.

### B. Table: rendered grid with `data-source` format preservation

The key insight (research-verified): markdown-it's **token stream** keeps each cell's **source** content (`inline content="*em*"`), and its renderer can inject that source onto the rendered `<td>/<th>` as a `data-source` attribute — while the cell body renders normally.

`TableWidget` renders the table with these `data-source` attributes. Each `<td>/<th>` is `contenteditable`. Editing flow:

```
cell input → update that cell's text (render text) + keep data-source if user only
  touched plain text; if the source had inline markers (*em*, `code`, [link](u))
  and the user edited inside them, re-wrap: carry the marker around the new text
  → debounce → serialize cells+align back to pipe syntax
  → view.dispatch({ changes: block.from..block.to = newTableSource })
  → rebuild
```

- **Cell content:** rendered text (`em`, link text). `data-source` holds `*em*` / `[link](u)`.
- **Format preservation heuristic (exact rule):** for a cell, if its `data-source` **starts and ends with the same non-empty marker string** (one of `**`, `*`, `` ` ``, `~~`, `__`, `_`) and the marker is 1-2 chars, then:
  - Let `inner = data-source.slice(m1.length, -m2.length)` and `newInner = cell's current text`.
  - If `inner !== newInner` (user edited the text), write `m1 + newInner + m2` back as the new source.
  - If the user edited such that the source no longer matches the marker pattern, or the marker is anything else (e.g. a link `[text](url)`, an image, or no simple wrap), write **the cell's current text verbatim as plain text** (format lost, never corrupts).
- **Alignment:** kept from the separator row; serialize back with `:---:` / `---:` markers.
- **Escaped pipes** (`\|`) and backslashes: if a cell's text is unchanged, write its original `data-source` back verbatim; only cells the user actually edited are re-serialized.

### C. Image / Math: persistent corner badge → source flip

`ImageWidget` and `MathBlockWidget` (inline + block) get a small persistent badge in their top-right corner (e.g. a "source"/`⌄` glyph):

- Default: rendered (image / KaTeX output), badge visible.
- Click badge → flip that block to source (widget replaced by source range; cursor placed inside) — same as current "click flips block" but **only via the badge**, not arbitrary clicks.
- Click badge again / move away → flip back to rendered.
- Badge is small, low-contrast, non-interactive unless hovered (except click target).

## Component / File Changes

- `src/editor/widgets.ts`
  - `CodeBlockWidget`: wrap `<code>` in `contenteditable`; add input handler + debounce.
  - `TableWidget`: use a custom markdown-it renderer that injects `data-source`; make cells `contenteditable`; add serialization (cells+align → pipe syntax) + edit handler.
  - `ImageWidget`, `MathInlineWidget`, `MathBlockWidget`: add persistent source badge; click badge flips to source.
- `src/editor/markdown.ts`
  - Add a table renderer variant (or option) that injects `data-source` attributes.
- `src/editor/livePreview.ts`
  - The `handleBlockClick` mousedown interceptor currently flips code/table blocks; **remove** it for code/table (they now edit in place). Keep/flip logic for image/math badge clicks.
- `src/styles.css` — badge styles; `contenteditable` focus outline; table cell editing affordance.

## Data Flow

```
Render: source → markdown-it (+data-source injection) → widget DOM
Edit (code): contenteditable text → dispatch block.replace(source)
Edit (table): cell text + data-source → serialize matrix → dispatch block.replace(pipeSource)
Badge (image/math): badge click → cursor into source range → flip to source
```

## Error Handling

- Debounce prevents excessive rebuilds.
- Table serialization is defensive: if a cell can't be confidently serialized (malformed), write the cell's current `data-source` (source form) verbatim rather than guessing.
- `contenteditable` is contained; the CM6 doc is only mutated via `view.dispatch`, keeping the syntax tree valid.

## Testing

- Unit tests (jsdom, `src/editor/__tests__/`):
  - `tableInlineEdit.test.ts` — cell editing → serialized pipe source round-trips; escaped pipes preserved; alignment kept; `data-source` re-wrap heuristic.
  - `codeBlockInlineEdit.test.ts` — `contenteditable` input → block.replace dispatch; debounce coalescing; undo is one step.
  - `badge.test.ts` — image/math badge toggles source flip.
- Existing `cursorLineEdit`, `blockClick`, `livePreview` tests updated: code/table no longer flip on click (assert edit-in-place instead).
- Manual: real app — edit code block in place, edit table cells, image/math badge flip.

## Out of Scope

- Nested/multi-line table cells with complex alignment.
- Drag-resize columns/rows (read-only structure; edit content only).
- Full WYSIWYG for arbitrary markdown inside cells beyond the wrap-preservation heuristic.

## Build & Release

- Bump version (patch) once implemented; build via `npm run tauri build` (never raw `cargo build`).
