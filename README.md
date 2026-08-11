**[English](README.md) | [简体中文](README.zh-CN.md)**

# Markion

A fast, local-first **Markdown editor** for Windows, macOS, and Linux. Obsidian-style live preview, Yuque-style hierarchical document tree, and a plain-files-on-disk storage model that works with your existing sync setup.

![MIT License](https://img.shields.io/badge/license-MIT-green)
![Tauri 2](https://img.shields.io/badge/Shell-Tauri%202-blue)
![Rust](https://img.shields.io/badge/Rust-1.97-orange)
![React 18](https://img.shields.io/badge/UI-React%2018-61dafb)
![CodeMirror 6](https://img.shields.io/badge/Editor-CodeMirror%206-0f9d58)

> ⚡ Write Markdown the way you think — the editor renders as you type, hides the syntax noise, and keeps your notes as plain files you own.

![Markion first run](assets/markion-screenshot.png)

---

## Features

| | |
|---|---|
| 🪄 **Live Preview** | Obsidian-style: other lines render as you type; the line your cursor is on shows the markdown source so you can edit directly. Edit ⇄ Preview modes. |
| 🌲 **Hierarchical Document Tree** | Yuque-style nested folders, collapse/expand, double-click folders, drag-and-drop reordering and cross-folder moves, hide dotfiles. |
| 🧭 **Outline / Backlinks / Graph** | Toggleable right panels: live outline, `[[wikilink]]` backlinks, and a zoomable/panable note graph. |
| ✅ **GFM + Extras** | Tables, task lists, strikethrough, syntax highlighting, Mermaid diagrams, KaTeX math (`$$..$$` & `$..$`), YAML frontmatter. |
| 🎨 **Themes & Fonts** | 11 themes (Light/Dark/Sepia/Eye-care/Nord/Dracula/Solarized/Tokyo/Catppuccin/Gruvbox/System) + 5 font choices. |
| 🌐 **Bilingual** | 中文 / English UI with a built-in documentation (F1) and keyboard-shortcuts overview. |
| 📁 **Local-First** | Reads and writes plain `.md` files on disk. No proprietary database, no lock-in. Default vault auto-opens on startup. |
| ⚡ **Fast & Light** | CodeMirror 6 editor core and a Rust (Tauri 2) backend. Small footprint, low memory, instant startup. |

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

## Roadmap

**Done**
- [x] Live preview (headings / bold / italic / inline code / links / tables / task lists / code blocks / blockquotes / images / math)
- [x] Hierarchical file tree + drag-and-drop + double-click expand + hide dotfiles
- [x] Outline / Backlinks / Graph panels (toggleable) + graph zoom & pan
- [x] Image paste/drag-drop UI integration
- [x] External file-change watcher (live tree refresh + reload)
- [x] Settings persistence (`.markion/config.json`) + default vault auto-open
- [x] Mermaid diagrams + KaTeX math (block `$$...$$` + inline `$...$`)
- [x] Backlinks panel ([[wikilink]] reverse lookup)
- [x] Menu bar: File · Edit · Format · View · Help (bilingual 中文/English)
- [x] 11 themes + font choices + word count
- [x] In-app documentation (F1)

---

## License

[MIT](LICENSE)
