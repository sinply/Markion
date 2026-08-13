# Markion Wiki Links / Command Palette / External-Change Conflict Design

**Date:** 2026-08-13
**Status:** Draft

## Problem

Three capabilities from the original v1 "later" backlog are still missing, despite the surrounding
infrastructure already being in place (Rust `find_backlinks`, `scan_graph`, the Backlinks panel and
Graph panel, and the full `runMarkdownCommand` + menu system):

1. **Wiki links (`[[...]]`) are not editable in the editor.** The Backlinks panel only lights up
   when a note happens to contain a hand-typed `[[path]]` string; the editor itself does not render
   the link, does not let you click through to the target, and offers no autocomplete when you type
   `[[`.
2. **`Ctrl+P` only searches filenames.** The Obsidian-style command palette (file search + run any
   command) is not implemented; every command is reachable only via the menu bar.
3. **External changes to a dirty document are silently discarded.** `useExternalChanges.ts` keeps
   the user's in-memory edits when a dirty file changes on disk, but never surfaces a choice — the
   v1 spec's promised "keep mine / load disk" dialog is missing.

## Goals

- Render `[[wikilink]]` in live preview with click-through and completion, matching the existing
  `find_backlinks` / `scan_graph` stem-matching convention.
- Upgrade `Ctrl+P` into a single palette that searches files and runs every command the menu bar
  exposes.
- Surface an explicit "keep mine / load disk" choice when a dirty document changes on disk.

## Non-Goals

- No bidirectional-link (backlink) rewrite — the existing Backlinks panel stays as-is.
- No `[[link#heading]]` anchor resolution; only whole-note links.
- No refactor of `MenuBar` onto the new command registry in this change (the palette owns its own
  command list; unifying the two is deferred).
- No diff view in the conflict dialog (deferred; the dialog is a two-way choice).

---

## Feature 1 — Wiki links `[[...]]`

### 1.1 Rendering

Add a wikilink pass to `buildDecorations` in `src/editor/livePreview.ts`, mirroring the existing
block-math / inline-math regex scans:

1. Scan the doc with `\[\[([^\]\n]+)\]\]`.
2. For each match, **exclude code context**: resolve the position with `syntaxTree(state).resolve(pos)`
   and skip if any ancestor node type is `FencedCode`, `CodeBlock`, or `InlineCode`. This reuses the
   Lezer tree (which already parses fenced code and inline code) so `[[` inside code is never styled
   or clickable.
3. If the range lies on the cursor's active line (`isOnActiveLine`), keep the source editable — do
   not hide the brackets (consistent with every other inline element).
4. Parse the token into `target` and `alias`:
   - `[[name]]` → target `name`, no alias
   - `[[path/name]]` → target `path/name`
   - `[[name|alias]]` → target `name`, alias `alias`
   - `[[path/name|alias]]` → target `path/name`, alias `alias`
   - Visible text = alias if present, else the basename (text after the last `/`).
5. Hide the `[[` and `]]` markers (`markHiddenAt`) and apply a mark over the visible text with class
   `cm-wikilink` plus `cm-wikilink-unresolved` when the target does not resolve.

### 1.2 Resolution index

New module `src/editor/wikiIndex.ts`:

- A module-level `Map<string, string>` from **lowercased stem** → **relative path** (forward slashes).
- `setWikiIndex(files: { name: string; path: string }[])` rebuilds it from the vault file list.
- `resolveWikiLink(target: string): string | null` — lowercases the target, strips a leading path
  (uses the text after the last `/`), strips a `|alias`, and looks up the stem. This is the same
  convention as `backlinks.rs` (`stem` = filename without `.md`, case-insensitive).
- `isWikiLinkResolved(target: string): boolean`.

The index is populated by a `useWikiIndex()` hook (mounted in `Layout`) that subscribes to
`vaultStore.tree` and calls `setWikiIndex` with the flattened file list whenever the tree changes.
For the palette and file-open flows this same index backs completion.

### 1.3 Click-through

Add a `.cm-wikilink` branch to the `click` event handler in `livePreview.ts`:

- **Resolved + Ctrl/Cmd+Click** → `readFile(vaultRoot, path)` → `openDoc(title, path)` +
  `setActiveContent(content)` + `ui.addRecent(path)`.
- **Unresolved + plain click** → create the note (see 1.4) then open it.
- **Resolved + plain click** → do not intercept (cursor placement works as normal).

`vaultRoot` is available to the click handler via `view.state.facet(markdownContextFacet)[0]`
(the `MarkdownContext` already carries `vaultRoot` and `docRel`).

### 1.4 Creating a missing note

New Rust command `create_file(vault_root, path)`:

- Creates parent directories, then writes an empty file only if it does not already exist
  (never overwrites).
- Wired into `commands.rs`, `lib.rs`'s `generate_handler!`, and `src/lib/ipc.ts` as `createFile`.

On unresolved-click, the frontend derives the new path from the target **relative to the current
document's directory** (Obsidian default): if the target contains a `/`, use it as-is; otherwise
`<docDir>/<target>.md`. After `createFile` succeeds, refresh the tree (`loadTree`) and open the new
note.

### 1.5 Autocomplete

New `src/editor/wikilink.ts` + new dependency `@codemirror/autocomplete`:

- A context-aware completion source: when the text immediately before the cursor is `[[` (or a
  partial target after it), offer all indexed stems (with their relative paths as detail).
- Selecting a candidate inserts `<name>]]`.
- When no candidate matches the partial input, append a synthetic "Create note: X" entry that
  creates the file (1.4) and inserts the link.
- Wired into `codemirror.ts` as a top-level extension (always on, independent of the live-preview
  toggle, like `imagePasteDropExtension`).

---

## Feature 2 — Command palette

Rewrite `src/components/QuickOpen.tsx` into `CommandPalette.tsx` (still triggered by `Ctrl+P`).

### 2.1 Command registry

New module `src/lib/commands.ts` exporting:

```ts
interface Command {
  id: string;
  title: string;        // localized label
  keywords?: string[];  // extra match tokens
  run: () => void;      // synchronous or fire-and-forget
}
```

Commands cover the full menu surface:

- Markdown formatting: bold / italic / strike / inline code / headings 1–3 / code block / table /
  quote / bullet / ordered / task / link / image → `ui.requestMarkdown(cmd)`.
- Edit: undo / redo / cut / copy / paste / select-all → `ui.requestEdit(cmd)`.
- File: open folder / open file / save / save-as → `ui.requestOpenFolder()` etc.
- View: edit mode / preview mode → `ui.setEditorMode(...)`; theme sub-commands → `settings.setTheme(...)`;
  language → `settings.setLanguage(...)`.
- New note (creates via `createFile` then opens), open settings.

Each command carries a display shortcut string for the palette footer.

### 2.2 Palette behavior

- Two-item input: files (flattened from the vault tree, same as today) + commands.
- Filtering: case-insensitive substring match over title + keywords. Files render with a file icon,
  commands with a command glyph; the matched type is shown.
- Keyboard: ↑/↓ move selection, Enter runs/opens, Esc closes; Enter on the top match opens it.
- A "New note: X" entry is shown when no file matches a query, consistent with the wikilink flow.

---

## Feature 3 — External-change conflict dialog

### 3.1 Detection

Modify `src/hooks/useExternalChanges.ts`:

When a `vault-changed` event arrives and the active doc's path is in the changed set:

- If the doc is **clean** → reload from disk into the live editor via
  `getEditorView()?.dispatch(...)` (fixes the current bug where `setActiveContent` alone does not
  refresh the mounted editor).
- If the doc is **dirty** → read the disk content and compare against the editor's live text
  (`getEditorView()?.state.doc.toString()`):
  - **Equal** → ignore (this is the watcher echoing our own auto-save; without this check every
    save would pop the dialog).
  - **Different** → set `uiStore.conflict = { path, diskContent }`.

### 3.2 Dialog

New `src/components/ConflictDialog.tsx`, mounted in `App.tsx`:

- Shows the path and a two-button choice:
  - **Keep my edits** → dismiss; editor untouched.
  - **Load disk version** → `getEditorView()?.dispatch` replace-full-doc with `diskContent`,
    `markClean(path)`, `setActiveContent(diskContent)`, dismiss.
- Localized strings added to `src/lib/i18n.ts` (zh + en).

### 3.3 Store

Add to `uiStore`: `conflict: { path: string; diskContent: string } | null` and
`setConflict(c)`. The dialog subscribes to it.

---

## Component / File Changes

- `src/editor/livePreview.ts` — wikilink render pass + click branch (resolved/unresolved).
- `src/editor/wikiIndex.ts` — resolution index (new).
- `src/editor/wikilink.ts` — autocomplete source (new).
- `src/editor/codemirror.ts` — attach the autocomplete extension.
- `src/lib/commands.ts` — command registry (new).
- `src/components/CommandPalette.tsx` — replaces `QuickOpen.tsx`.
- `src/components/ConflictDialog.tsx` — conflict dialog (new).
- `src/hooks/useExternalChanges.ts` — dirty/clean reload + conflict detection.
- `src/stores/uiStore.ts` — `conflict` state.
- `src/stores/vaultStore.ts` — no change (tree already exposes the file list).
- `src/hooks/useWikiIndex.ts` — populates the wiki index from the tree (new).
- `src/lib/ipc.ts` — `createFile` wrapper.
- `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs` — `create_file` command.
- `src/lib/i18n.ts` — new strings (zh + en).
- `src/styles.css` — `.cm-wikilink`, `.cm-wikilink-unresolved`, palette/conflict styles.
- `package.json` — add `@codemirror/autocomplete`.

## Data Flow

```
Render:  doc → regex [[..]] (exclude code, skip active line) → resolve via wikiIndex
         → hide [[ ]] + style visible text (resolved / unresolved)
Click:   .cm-wikilink → resolved & Ctrl → open; unresolved → create + open
Complete: [[ partial → candidates (stems) → insert name]]  |  no match → "New note: X"
Conflict: watcher event → dirty? → compare disk vs editor → equal? ignore : show dialog
         → keep mine (noop) | load disk (replace doc + markClean)
```

## Error Handling

- `create_file` never overwrites; on IO error it surfaces a toast-like silent no-op (the existing
  codebase pattern is to swallow and keep the editor usable).
- Unresolved-link click that fails to create leaves the editor unchanged.
- The conflict dialog's "equal" short-circuit prevents auto-save echo from spamming the dialog.
- The wiki index rebuilds from the tree on every structural change, so a stale entry simply falls
  back to "unresolved" styling rather than a wrong open.

## Testing

- `src/editor/__tests__/wikilink.test.ts` — render marks `[[a]]` as `cm-wikilink`; excludes `[[` in
  fenced code and inline code; alias/basename display; stem resolution (case, `path/name`, `|alias`).
- `src/editor/__tests__/wikilinkCompletion.test.ts` — completion lists stems; inserting `name]]`;
  "New note" entry when no match.
- Rust: `create_file` creates dirs, does not overwrite existing (in `commands.rs` or a small
  `#[cfg(test)]` module).
- `src/lib/__tests__/commands.test.ts` (or `src/components/__tests__/`) — palette filter matches
  files + commands; Enter runs.
- `src/hooks/__tests__/` or store test — conflict detection: self-save echo is ignored, external
  change with diff shows conflict, keep-mine vs load-disk transitions.

## Out of Scope

- `[[link#heading]]` anchors, per-block wikilink editing, backlink rewrite.
- Diff view in the conflict dialog.
- Refactoring `MenuBar` onto the command registry.
