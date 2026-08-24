**[English](README.md) | [简体中文](README.zh-CN.md)**

# Markion

A fast, local-first Markdown **knowledge base** for **Windows**, built the Yuque way: one seamless view where the document always renders and you type straight into it — no edit/preview mode switching. Folders can act as document containers or auto-derived data tables, tags live in note properties, and every byte stays in plain `.md` files on disk. No database lock-in, easy to back up and sync with whatever tool you already use. macOS and Linux builds are planned (the app is built on the cross-platform Tauri 2 shell).

![MIT License](https://img.shields.io/badge/license-MIT-green)
![Tauri 2](https://img.shields.io/badge/Shell-Tauri%202-blue)
![Rust](https://img.shields.io/badge/Rust-1.97-orange)
![React 18](https://img.shields.io/badge/UI-React%2018-61dafb)
![CodeMirror 6](https://img.shields.io/badge/Editor-CodeMirror%206-0f9d58)

> ⚡ Write Markdown the way you think — the editor renders as you type, hides the syntax noise, and keeps your notes as plain files you own.

![Markion first run](assets/markion-screenshot.png)

---

## Features

### ✍️ Writing & Editing

| | |
|---|---|
| 🪄 **One seamless view** | Yuque-style: the document always renders — headings, tables, code cards — and you type directly into it. No Edit ⇄ Preview toggling; the cursor reveals source only where you're working. |
| 🖱️ **Multi-cursor & Column select** | Alt+click to add cursors, Shift+Alt+drag for column selection. |
| 🎯 **`[[note#heading]]` anchors** | Wikilinks with a `#heading` anchor resolve correctly and scroll to the target heading on open. |
| 🧘 **Focus mode** | The paragraph under the cursor stays lit with an accent bar, everything else in view fades, and the side panels collapse for distraction-free writing. |
| 📑 **Heading folding** | Fold gutters + keyboard shortcuts to collapse/expand sections. |
| 🎛️ **Editor context menu** | Cut / copy / paste / select-all on right-click. |

### 📄 Markdown Rendering

| | |
|---|---|
| ✅ **GFM + Extras** | Tables, task lists, strikethrough, footnotes `[^1]`, highlight `==text==`, superscript `^x^` / subscript `~x~`. |
| 📊 **Mermaid** | Full diagram support: `mermaid`, `gantt`, `sequenceDiagram`, `flowchart`, `classDiagram`, `erDiagram`, `pie`, `journey`, `mindmap` and more. Click a diagram to flip back to source. |
| 🧮 **KaTeX math** | Block `$$..$$` and inline `$..$` formulas. |
| 💬 **Callouts** | `> [!note]` / `[!tip]` / `[!warning]` / … — 16 types rendered as colored cards. |
| 🎨 **Syntax highlighting** | 190+ languages while rendering (highlight.js) AND while editing fence source (CodeMirror language packages, loaded on demand) — including SystemVerilog / Verilog. |
| 🔗 **Paste URL as link** | Pasting a bare URL becomes `[selected](url)` automatically. |

### 🗂️ Notes & Organization

| | |
|---|---|
| 🌲 **Hierarchical document tree** | Yuque-style nested folders, drag-and-drop reorder / cross-folder moves, context menu (new/rename/delete → trash), hide dotfiles (toggle in settings). |
| 🏢 **Document containers** | A folder with an `index.md` opens as one page; its children list below the editor — switchable to a table view. |
| 🗃️ **Folder-as-database** | Any folder renders its notes as a data table: columns auto-inferred from frontmatter keys (number/date/tags/text), sortable, filterable, double-click a cell to write back to the note's YAML. Also available via right-click → "View as Table". |
| 🏷️ **Tags from properties** | Tags are note metadata: `tags:` in the YAML header. The tag panel filters by them — body `#fragments` never pollute the list. |
| 🧭 **Outline / Backlinks / Graph** | Toggleable right panels: live outline (drag headings to reorder), `[[wikilink]]` backlinks, zoomable note graph. |
| 🏢 **Multi-vault** | Switch between recently opened vaults from the File menu; pin a default vault to auto-open. |
| 🔤 **Smart rename** | Renaming a file/folder rewrites every `[[wikilink]]` reference vault-wide. |
| 📑 **Tab management** | Drag tabs to reorder, reopen recently closed tabs (Ctrl+Shift+T). |

### ⚙️ Productivity

| | |
|---|---|
| ⌨️ **Command palette** | Every action searchable (Ctrl+P). |
| ✨ **Slash commands** | `/` opens 19 markdown insertions. |
| 📝 **Templates & Daily notes** | Configurable template folder; "Open Today's Note" entry is opt-in (Settings). |
| 🏷️ **Properties editor** | Visual editor for YAML frontmatter (title, tags, dates, custom keys). |
| 📋 **Table of Contents** | Insert a clickable, indented TOC generated from your headings. |
| 🔧 **Customizable shortcuts** | Rebind any shortcut in Preferences; stored per-vault, applies instantly. |
| 🔍 **Find & replace** | In-editor Ctrl+F/H plus vault-wide regex search & replace. |
| 🗑️ **In-app recycle bin** | Deleted files go to `.markion/trash`; restore from "Recently Deleted". |
| 🖱️ **Table operations** | Add/remove rows & columns from the table toolbar; "Format Table" command. |

### 📤 Export

| | |
|---|---|
| 🌐 **HTML** | Self-contained: KaTeX + highlight.js styles inlined, local images base64-inlined. |
| 📄 **PDF** | Direct PDF file export (rendered via canvas), or the OS print dialog. |
| 🖼️ **PNG** | Export the note as an image. |
| 📄 **Markdown** | Raw source export. |

### 🎨 Appearance & Language

| | |
|---|---|
| 🎨 **Themes & Fonts** | 11 themes (Light/Dark/Sepia/Eye-care/Nord/Dracula/Solarized/Tokyo/Catppuccin/Gruvbox/System) + 5 font choices. |
| 🌐 **Bilingual** | 中文 / English UI with built-in documentation (F1) and a shortcut overview. |
| 📁 **Local-first** | Plain `.md` files on disk, no proprietary database. Auto-save, external-change detection, default vault auto-open. |
| ⚡ **Fast & Light** | CodeMirror 6 editor core and a Rust (Tauri 2) backend. Small footprint, instant startup. |

---

## Quick Start

### Prerequisites

- **Node.js** >= 20
- **Rust** stable toolchain (`rustup`)
- **Windows**: MSVC C++ Build Tools (Visual Studio Build Tools with the "Desktop development with C++" workload)
- **macOS/Linux**: Xcode Command Line Tools / `build-essential`

### Run it

```bash
# Install dependencies
npm install

# Development mode (hot reload, opens the desktop window)
npm run tauri dev

# Frontend only (browser preview at http://localhost:5173, no Tauri features)
npm run dev
```

> The Vite dev server runs on **port 5173** by default.

### Build & test

```bash
npx tsc --noEmit         # TypeScript type check
npx vitest run           # Frontend unit tests

cd src-tauri
cargo check              # Rust type check
cargo test               # Rust unit tests

cd ..
npm run tauri build      # Production build → src-tauri/target/release/
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | [Tauri 2](https://tauri.app) — Rust backend + WebView frontend |
| Editor | [CodeMirror 6](https://codemirror.net) + @lezer/markdown + markdown-it + lowlight |
| UI | React 18 + react-arborist + react-resizable-panels + Zustand |
| Backend | Rust (serde, notify, sha2, pathdiff, walkdir) |
| Testing | vitest + jsdom (frontend), `#[cfg(test)]` + tempfile (Rust) |

---

## Project Structure

```
Markion/
├── src/                      # Frontend (React + TypeScript)
│   ├── components/           # UI components (Layout / FileTree / EditorPane / Outline …)
│   ├── editor/               # CodeMirror 6 editor core
│   │   ├── livePreview.ts    #   Live-preview decorations (headings/bold/tables/code/tasks)
│   │   ├── widgets.ts        #   Block-level widgets (code blocks / tables / task checkboxes)
│   │   └── markdown.ts       #   markdown-it + lowlight renderer
│   ├── stores/               # Zustand state (vaultStore / docStore / settingsStore)
│   └── lib/                  # IPC wrappers + shared types
├── src-tauri/                # Rust backend (Tauri)
│   ├── src/
│   │   ├── file_io.rs        #   Atomic file reads/writes
│   │   ├── tree_index.rs     #   Document tree (FS + index hybrid model)
│   │   ├── image.rs          #   Image hashing / dedup / path resolution
│   │   ├── watcher.rs        #   File-system watcher
│   │   └── commands.rs       #   Tauri command handlers
├── assets/                   # Screenshots & media
└── docs/superpowers/         # Design specs & implementation plans
```

## Document Tree Model

The file system is the **single source of truth**; `.markion/index.json` stores only per-folder sort order and collapse state:

- **Same-folder drag-reorder** → updates the index only
- **Cross-folder move** → renames the file on disk + updates both folders' index entries
- **External delete/rename** → the index self-cleans; nothing blocks

---

## License

[MIT](LICENSE)
