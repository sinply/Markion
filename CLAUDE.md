# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Session start (mandatory)

**Always sync git BEFORE starting any work**: `git pull` first thing in every session. The repo is worked on from multiple machines/sessions - remote `main` may have commits this session doesn't know about (e.g. v0.11.4 features once landed remotely while a local session was unaware). Pulling first prevents duplicate work, merge conflicts, and stale-code edits. If `src-tauri/Cargo.lock` has local build-artifact noise, discard it (`git checkout -- src-tauri/Cargo.lock`) and pull again. Also read `docs/BACKLOG.md` to avoid re-implementing existing features.

## Project

Markion — a Tauri 2 desktop Markdown editor with Obsidian-style live preview and a Yuque-style document tree. Local-first, works with plain `.md` files on disk.

## Tech Stack

- **Shell**: Tauri 2 (Rust backend, webview frontend)
- **Editor**: CodeMirror 6 + @lezer/markdown + markdown-it + lowlight
- **UI**: React 18 + react-arborist + react-resizable-panels + Zustand
- **Backend**: Rust (serde, notify, sha2, pathdiff, walkdir)
- **Test**: vitest + jsdom (frontend), `#[cfg(test)]` + tempfile (Rust)

## Commands

```bash
# Frontend
npm install              # Install deps
npx tsc --noEmit         # Type-check
npx vitest run           # Run frontend unit tests
npm run dev              # Vite dev server (port 5173)

# Backend (requires Rust toolchain + MSVC build tools on Windows)
cd src-tauri
cargo check              # Type-check Rust
cargo test -- --nocapture   # Run Rust unit tests

# Full app (requires both)
npm run tauri dev        # Launch desktop app in dev mode
npm run tauri build      # Production build
```

## Release process

- **Every code change** is pushed to the `main` branch (`feat/backend-foundation` → `main`) and bump the version in package.json / Cargo.toml / tauri.conf.json / AboutDialog.
- **GitHub Release (exe) is created ONLY for significant, bug-free feature versions** — e.g. v0.6.0, v0.7.0, v0.8.0. Do NOT create a release for every small patch; too many releases is noise. Small fixes just bump the patch version and push code.
- Only create a release when the build passes tests and the feature set is stable.
- **Build the release exe with `npm run tauri build`, NEVER raw `cargo build --release`.** The Tauri CLI enables the `tauri/custom-protocol` feature, which embeds the frontend into the exe. Without it the exe is compiled as a dev build that loads `http://localhost:5173` and shows a **white screen** when run standalone (no dev server). Verify the exe loads `http://tauri.localhost` before attaching it to a release.
- **After changing app icons** (`src-tauri/icons/*`): `tauri-build` does NOT watch the icons directory, so a plain rebuild reuses the old cached `.res` (stale icon embedded in the exe). Run `touch src-tauri/build.rs` before `npm run tauri build` to force the build script to re-embed the new icons. Windows Explorer also caches exe icons — after replacing icons, restart `explorer.exe` (or clear `%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache_*.db`) to see the new icon.

## Architecture

### Process boundary
- **Rust backend** (`src-tauri/src/`): owns all filesystem access; exposes `#[tauri::command]` handlers invoked from the frontend via `invoke()`.
- **Webview frontend** (`src/`): React + CM6 editor; calls backend through typed wrappers in `src/lib/ipc.ts`.

### Backend modules
- `file_io.rs` — atomic reads and writes (temp-file + rename)
- `tree_index.rs` — FS+index hybrid document tree; merge logic, `IndexFile` JSON serialization
- `image.rs` — image hashing, dedup, configurable save path resolution
- `watcher.rs` — `notify`-based recursive vault watcher with debounced event coalescing
- `commands.rs` — Tauri `#[tauri::command]` handlers wired to above modules

### Frontend layers
- `src/lib/types.ts` — shared TypeScript types (`TreeNode`, `Settings`, etc.)
- `src/lib/ipc.ts` — typed `invoke()` wrappers for every Tauri command
- `src/editor/` — CodeMirror 6 editor (see below)
- `src/stores/` — Zustand stores (`vaultStore`, `docStore`, `settingsStore`)
- `src/components/` — React UI components (3-pane layout, file tree, tabs, outline, etc.)

### Editor core
- `codemirror.ts` — `createEditorState()` factory: CM6 extensions bundle (markdown lang, live preview, syntax highlighting, keymaps)
- `livePreview.ts` — `ViewPlugin` that walks the Lezer markdown tree and builds `DecorationSet` (hide syntax markers, replace blocks with widgets)
- `widgets.ts` — `WidgetType` classes: `CodeBlockWidget`, `TableWidget`, `TaskCheckboxWidget`
- `markdown.ts` — markdown-it + lowlight config, `hastToHtml` helper
- `EditorView.tsx` — React wrapper mounting CM6 via ref with imperative `getDoc()`/`setDoc()`

### Vault / document tree
The doc tree is a **file+index hybrid**:
- Filesystem is source of truth for structure
- `.markion/index.json` stores per-folder sort order, collapse state, and metadata
- `merge_order()` merges FS children with indexed order; indexed-then-existing items come first, new FS items are appended sorted
- Same-folder drag-reorder mutates only the index; cross-folder move renames the file and updates both folders' index entries

## File conventions
- TS files use double quotes, semicolons.
- Rust files use standard `cargo fmt` style.
- New editor features go in `src/editor/`, tested in `src/editor/__tests__/`.
- New UI components go in `src/components/`, tested alongside or in `src/stores/__tests__/` (stores).
- IPC wrappers are always added to `src/lib/ipc.ts` and registered in both `commands.rs` and `generate_handler!`.

## Environment requirements
- **Node.js** ≥ 20, **npm** ≥ 10
- **Rust** toolchain (rustup, stable): `rustc`, `cargo`
- **Windows**: MSVC C++ Build Tools (VS 2022 BuildTools with `Microsoft.VisualStudio.Workload.VCTools`); link.exe must be on PATH
- **macOS/Linux**: Xcode command-line tools / `build-essential`

## Design docs
- Spec: `docs/superpowers/specs/2026-07-31-markion-editor-design.md`
- Plans: `docs/superpowers/plans/2026-07-31-markion-*.md`
