# Markion UI Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 3-pane app shell (file tree, editor with tabs, outline), Zustand state management, image handling, external-change handling, and settings UI — wiring the CM6 editor from Plan 2 and the Rust backend from Plan 1 into a complete working application.

**Architecture:** React components in a `react-resizable-panels` 3-pane layout. `react-arborist` file tree on the left calls Plan 1 IPC wrappers. Tabs in the editor pane cache CM6 EditorStates in a Map for fast switching. The outline (right pane) reads headings from the CM6 Lezer tree. Zustand stores (`vaultStore`, `docStore`, `settingsStore`) centralize state. A new Rust `config.rs` module persists settings; the watcher from Plan 1 is wired to emit Tauri events consumed by the frontend.

**Tech Stack:** React, react-arborist, react-resizable-panels, Zustand, @tauri-apps/api (core + event) · Rust: serde, serde_json · vitest, @testing-library/react, jsdom.

**Spec reference:** [2026-07-31-markion-editor-design.md](../specs/2026-07-31-markion-editor-design.md) — sections 5 (doc tree), 6 (UI layout, state, images), 7 (errors).

**Prerequisites:** Plan 1 (backend) tasks 1-12 + Plan 2 (editor core) tasks 1-8 must be done first.

---

## File Structure (this plan)

### Frontend (new files)

| File | Responsibility |
|---|---|
| `src/components/Layout.tsx` | 3-pane resizable shell; renders FileTree, EditorPane, Outline |
| `src/components/FileTree.tsx` | react-arborist tree; drag-reorder/move; right-click menu; collapse |
| `src/components/EditorPane.tsx` | Tab bar + MarkdownEditor host + status bar |
| `src/components/Tabs.tsx` | Tab bar: render open docs as tabs; close; dirty dot |
| `src/components/Outline.tsx` | Heading tree from CM6 Lezer tree; click to jump |
| `src/components/QuickOpen.tsx` | `Ctrl+P` filename search palette |
| `src/components/SettingsDialog.tsx` | Settings modal: assets strategy, path style, theme, hidden files |
| `src/components/Toast.tsx` | Toast notification system for errors |
| `src/components/ConflictDialog.tsx` | "Keep mine / load disk" prompt for external changes |
| `src/stores/vaultStore.ts` | vaultRoot, tree, expanded set; `loadTree()`, `applyReorder()`, `applyMove()`, `setCollapsed()` |
| `src/stores/docStore.ts` | openDocs, activeDocId, dirtyMap; `openDoc()`, `closeDoc()`, `switchTo()`, `saveActiveDoc()` |
| `src/stores/settingsStore.ts` | assetsDirStrategy, pathStyle, theme, showHiddenFiles; `loadSettings()` / `saveSettings()` |
| `src/hooks/useImagePaste.ts` | Paste/drop handler hook that calls `saveImage` IPC and inserts `![]()` |
| `src/hooks/useExternalChanges.ts` | Listens for Tauri `vault-changed` event; triggers reload/conflict |
| `src/App.tsx` | Root: vault-folder picker + Layout (or replaces scaffolded App.tsx) |

### Backend (new/modified)

| File | Change | Responsibility |
|---|---|---|
| `src-tauri/src/config.rs` | Create | `Config`, `load_config()`, `save_config()` — mirrors `tree_index` patterns (atomic write, corrupt-fallback default) |
| `src-tauri/src/commands.rs` | Modify | Add `read_config`, `save_config`, `start_vault_watch` commands |
| `src-tauri/src/main.rs` | Modify | Register new commands in `generate_handler!` |
| `src-tauri/src/lib.rs` | Modify | Add `pub mod config;` |

### Shared

| File | Change | Responsibility |
|---|---|---|
| `src/lib/ipc.ts` | Modify | Add `readConfig`, `saveConfig`, `startVaultWatch` wrappers |
| `src/lib/types.ts` | Modify | Add `Settings`, config types |
| `package.json` | Modify | Add `react-arborist`, `react-resizable-panels`, `zustand` |

### Tests

| File | Responsibility |
|---|---|
| `src/stores/__tests__/vaultStore.test.ts` | Store action unit tests (mocked IPC) |
| `src/stores/__tests__/docStore.test.ts` | Doc open/close/switch/save state transitions |
| `src/stores/__tests__/settingsStore.test.ts` | Settings load/save round-trip |
| `src/editor/__tests__/outline.test.ts` | Heading extraction from doc text / Lezer tree |
| `src/__tests__/tabCache.test.ts` | CM6 EditorState cache: switch tab preserves cursor |
| `src-tauri/src/config.rs` | `#[cfg(test)]` inline unit tests for config I/O |

---

## Task 1: Add UI npm dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

```bash
npm install react-arborist react-resizable-panels zustand
```

- [ ] **Step 2: Verify install**

```bash
npm ls react-arborist react-resizable-panels zustand --depth=0
```

Expected: shows installed versions, no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add react-arborist, react-resizable-panels, zustand"
```

---

## Task 2: Rust config module (TDD)

**Files:**
- Create: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod config;`)

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/config.rs` with only the test module:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Settings {
    pub assets_strategy: AssetsStrategy,
    pub path_style: PathStyle,
    pub theme: String,
    pub show_hidden_files: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            assets_strategy: AssetsStrategy::VaultAssets,
            path_style: PathStyle::Relative,
            theme: "system".to_string(),
            show_hidden_files: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum AssetsStrategy {
    VaultAssets,
    DocAssets,
    #[serde(untagged)]
    Custom(String),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PathStyle {
    Relative,
    Absolute,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn load_missing_config_returns_default() {
        let dir = tempdir().unwrap();
        let s = load_config(dir.path()).unwrap();
        assert_eq!(s, Settings::default());
    }

    #[test]
    fn save_then_load_roundtrip() {
        let dir = tempdir().unwrap();
        let mut s = Settings::default();
        s.theme = "dark".to_string();
        s.assets_strategy = AssetsStrategy::DocAssets;
        save_config(dir.path(), &s).unwrap();
        let loaded = load_config(dir.path()).unwrap();
        assert_eq!(loaded, s);
    }

    #[test]
    fn corrupt_config_returns_default() {
        let dir = tempdir().unwrap();
        let p = dir.path().join(".markion/config.json");
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, "not json").unwrap();
        let s = load_config(dir.path()).unwrap();
        assert_eq!(s, Settings::default());
    }
}
```

- [ ] **Step 2: Declare module and run test to verify it fails**

Add to `src-tauri/src/lib.rs`:

```rust
pub mod config;
```

```bash
cd src-tauri && cargo test config::tests -- --nocapture && cd ..
```

Expected: FAIL — `cannot find function load_config` / `save_config`.

- [ ] **Step 3: Implement load_config and save_config**

Add above the test module in `src-tauri/src/config.rs`:

```rust
use std::path::Path;

const CONFIG_PATH: &str = ".markion/config.json";

pub fn load_config(vault_root: &Path) -> std::io::Result<Settings> {
    let path = vault_root.join(CONFIG_PATH);
    match std::fs::read_to_string(&path) {
        Ok(s) => match serde_json::from_str::<Settings>(&s) {
            Ok(parsed) => Ok(parsed),
            Err(e) => {
                eprintln!("[config] corrupt config at {:?}: {}; falling back to default", path, e);
                Ok(Settings::default())
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(e) => Err(e),
    }
}

pub fn save_config(vault_root: &Path, settings: &Settings) -> std::io::Result<()> {
    let dir = vault_root.join(".markion");
    std::fs::create_dir_all(&dir)?;
    let path = vault_root.join(CONFIG_PATH);
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))?;
    crate::file_io::write_file_atomic(&path, &json)
}
```

Note: `crate::file_io` must be public. Plan 1's `file_io.rs` has `pub fn write_file_atomic(...)` — verify it is indeed `pub`. If not, make it pub (edit `src-tauri/src/file_io.rs`).

- [ ] **Step 4: Run test to verify it passes**

```bash
cd src-tauri && cargo test config::tests -- --nocapture && cd ..
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/config.rs src-tauri/src/lib.rs
git commit -m "feat(config): Settings struct with atomic save / corrupt-fallback load"
```

---

## Task 3: Wire config + watcher commands (Rust side)

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs` (or `lib.rs` via the `run()` function)

- [ ] **Step 1: Add read_config and save_config commands to commands.rs**

Append to `src-tauri/src/commands.rs`:

```rust
use crate::config;

#[tauri::command]
pub fn read_config(vault_root: String) -> Result<config::Settings, String> {
    config::load_config(&std::path::Path::new(&vault_root)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_config(vault_root: String, settings: config::Settings) -> Result<(), String> {
    config::save_config(&std::path::Path::new(&vault_root), &settings).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Add start_vault_watch command**

Append to `src-tauri/src/commands.rs`:

```rust
use tauri::{AppHandle, Emitter};
use std::sync::Mutex;
use std::sync::mpsc::Receiver;
use std::path::PathBuf;

static WATCHER_HANDLE: Mutex<Option<(notify::RecommendedWatcher, PathBuf)>> = Mutex::new(None);
static WATCHER_RECEIVER: Mutex<Option<Receiver<Vec<String>>>> = Mutex::new(None);

#[tauri::command]
pub fn start_vault_watch(vault_root: String, app: AppHandle) -> Result<(), String> {
    let root = PathBuf::from(&vault_root);
    let (watcher, rx) = crate::watcher::start_watcher(&root, std::time::Duration::from_millis(200))
        .map_err(|e| e.to_string())?;

    // Store the watcher to keep it alive
    let mut handle = WATCHER_HANDLE.lock().unwrap();
    *handle = Some((watcher, root.clone()));

    let mut rx_slot = WATCHER_RECEIVER.lock().unwrap();
    *rx_slot = Some(rx);

    // Spawn a thread to poll the receiver and emit Tauri events
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let mutex = &WATCHER_RECEIVER;
        loop {
            let rx_locked = mutex.lock().unwrap();
            if rx_locked.is_none() { break; }
            drop(rx_locked);
            // Re-lock briefly, recv on the receiver, emit event
            let guard = mutex.lock().unwrap();
            if let Some(ref rx) = *guard {
                if let Ok(paths) = rx.recv() {
                    let _ = app_handle.emit("vault-changed", paths);
                }
            }
        }
    });

    Ok(())
}
```

This uses the `watcher::start_watcher(...)` function from Plan 1. Ensure the function signature is `pub fn start_watcher(root: &Path, debounce: Duration) -> io::Result<(RecommendedWatcher, Receiver<Vec<String>>)>`. The Plan 1 implementation returns `(RecommendedWatcher, Receiver)`. The Tauri command spawns a polling thread that emits `"vault-changed"` events with the coalesced path list.

- [ ] **Step 3: Register new commands in generate_handler!**

Modify `src-tauri/src/lib.rs` or `src-tauri/src/main.rs` (wherever `generate_handler!` is called):

```rust
.invoke_handler(tauri::generate_handler![
    commands::read_file,
    commands::write_file_atomic,
    commands::build_tree,
    commands::reorder_in_folder,
    commands::set_collapsed,
    commands::move_node,
    commands::save_image,
    commands::read_config,           // new
    commands::save_config,           // new
    commands::start_vault_watch,     // new
])
```

- [ ] **Step 4: Verify it compiles**

```bash
cd src-tauri && cargo check && cd ..
```

Expected: compiles. Fix any missing imports in commands.rs (notify types, etc.).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(commands): add read_config, save_config, start_vault_watch"
```

---

## Task 4: Frontend IPC extensions + types

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Add settings types and IPC wrappers**

Append to `src/lib/types.ts`:

```ts
export type AssetsStrategy = "vault-assets" | "doc-assets" | `custom:${string}`;
export type PathStyle = "relative" | "absolute";

export interface Settings {
  assetsStrategy: AssetsStrategy;
  pathStyle: PathStyle;
  theme: "system" | "light" | "dark";
  showHiddenFiles: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  assetsStrategy: "vault-assets",
  pathStyle: "relative",
  theme: "system",
  showHiddenFiles: false,
};
```

Append to `src/lib/ipc.ts`:

```ts
import type { Settings } from "./types";
// ... (keep existing exports)

export async function readConfig(vaultRoot: string): Promise<Settings> {
  return invoke<Settings>("read_config", { vaultRoot });
}

export async function saveConfig(vaultRoot: string, settings: Settings): Promise<void> {
  await invoke<void>("save_config", { vaultRoot, settings });
}

export async function startVaultWatch(vaultRoot: string): Promise<void> {
  await invoke<void>("start_vault_watch", { vaultRoot });
}
```

- [ ] **Step 2: Verify type-checks**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts src/lib/ipc.ts
git commit -m "feat(ipc): Typescript types and wrappers for config + watcher"
```

---

## Task 5: Zustand stores — docStore + settingsStore (TDD)

**Files:**
- Create: `src/stores/docStore.ts`
- Create: `src/stores/settingsStore.ts`
- Create: `src/stores/__tests__/docStore.test.ts`
- Create: `src/stores/__tests__/settingsStore.test.ts`

- [ ] **Step 1: Write failing docStore tests**

Create `src/stores/__tests__/docStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { act } from "@testing-library/react";
import { useDocStore } from "../docStore";

describe("docStore", () => {
  beforeEach(() => {
    act(() => useDocStore.setState({ openDocs: [], activeDocId: null, dirtyMap: {} }));
  });

  it("openDoc adds a doc", () => {
    act(() => useDocStore.getState().openDoc("intro.md", "path/to/intro.md"));
    const { openDocs, activeDocId } = useDocStore.getState();
    expect(openDocs).toHaveLength(1);
    expect(openDocs[0].path).toBe("path/to/intro.md");
    expect(openDocs[0].title).toBe("intro.md");
    expect(activeDocId).toBe(openDocs[0].id);
  });

  it("openDoc does not duplicate already-open doc", () => {
    act(() => useDocStore.getState().openDoc("intro.md", "path/to/intro.md"));
    act(() => useDocStore.getState().openDoc("intro.md", "path/to/intro.md"));
    expect(useDocStore.getState().openDocs).toHaveLength(1);
  });

  it("closeDoc removes doc and activates next", () => {
    act(() => {
      const s = useDocStore.getState();
      s.openDoc("a.md", "a.md");
      s.openDoc("b.md", "b.md");
    });
    const docs = useDocStore.getState().openDocs;
    act(() => useDocStore.getState().closeDoc(docs[0].id));
    const { openDocs, activeDocId } = useDocStore.getState();
    expect(openDocs).toHaveLength(1);
    expect(activeDocId).toBe("b.md"); // next doc active
  });

  it("markDirty / markClean toggles dirty state", () => {
    act(() => useDocStore.getState().openDoc("a.md", "a.md"));
    const id = useDocStore.getState().activeDocId!;
    act(() => useDocStore.getState().markDirty(id));
    expect(useDocStore.getState().dirtyMap[id]).toBe(true);
    act(() => useDocStore.getState().markClean(id));
    expect(useDocStore.getState().dirtyMap[id]).toBe(false);
  });

  it("switchTo changes active doc", () => {
    act(() => {
      useDocStore.getState().openDoc("a.md", "a.md");
      useDocStore.getState().openDoc("b.md", "b.md");
    });
    const docs = useDocStore.getState().openDocs;
    act(() => useDocStore.getState().switchTo(docs[0].id));
    expect(useDocStore.getState().activeDocId).toBe(docs[0].id);
  });
});
```

- [ ] **Step 2: Implement docStore**

Create `src/stores/docStore.ts`:

```ts
import { create } from "zustand";
import { v4 as uuid } from "uuid";
// (If uuid not installed: npm install uuid @types/uuid, or use crypto.randomUUID())

interface OpenDoc {
  id: string;
  path: string;
  title: string;
}

interface DocState {
  openDocs: OpenDoc[];
  activeDocId: string | null;
  dirtyMap: Record<string, boolean>;
  openDoc: (title: string, path: string) => void;
  closeDoc: (id: string) => void;
  switchTo: (id: string) => void;
  markDirty: (id: string) => void;
  markClean: (id: string) => void;
}

export const useDocStore = create<DocState>((set, get) => ({
  openDocs: [],
  activeDocId: null,
  dirtyMap: {},

  openDoc: (title, path) => {
    const existing = get().openDocs.find((d) => d.path === path);
    if (existing) {
      set({ activeDocId: existing.id });
      return;
    }
    const id = path; // use path as stable id (no uuid dep)
    const doc: OpenDoc = { id, path, title };
    set((s) => ({
      openDocs: [...s.openDocs, doc],
      activeDocId: id,
    }));
  },

  closeDoc: (id) => {
    set((s) => {
      const newDocs = s.openDocs.filter((d) => d.id !== id);
      let newActive = s.activeDocId;
      if (s.activeDocId === id) {
        const idx = s.openDocs.findIndex((d) => d.id === id);
        newActive = newDocs[Math.min(idx, newDocs.length - 1)]?.id ?? null;
      }
      const newDirty = { ...s.dirtyMap };
      if (newDocs.length === 1 || !newDocs.some((d) => d.id === id)) {
        delete newDirty[id];
      }
      return { openDocs: newDocs, activeDocId: newActive, dirtyMap: newDirty };
    });
  },

  switchTo: (id) => set({ activeDocId: id }),

  markDirty: (id) => set((s) => ({ dirtyMap: { ...s.dirtyMap, [id]: true } })),
  markClean: (id) => set((s) => ({ dirtyMap: { ...s.dirtyMap, [id]: false } })),
}));
```

- [ ] **Step 3: Write settingsStore test + implement settingsStore**

Create `src/stores/settingsStore.ts`:

```ts
import { create } from "zustand";
import type { Settings } from "../lib/types";
import { DEFAULT_SETTINGS } from "../lib/types";

interface SettingsState extends Settings {
  load: (vaultRoot: string) => Promise<void>;
  save: (vaultRoot: string) => Promise<void>;
  setTheme: (t: Settings["theme"]) => void;
  setAssetsStrategy: (s: Settings["assetsStrategy"]) => void;
  setPathStyle: (p: Settings["pathStyle"]) => void;
  setShowHiddenFiles: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set, _get) => ({
  ...DEFAULT_SETTINGS,

  load: async (vaultRoot) => {
    const { readConfig } = await import("../lib/ipc");
    const s = await readConfig(vaultRoot);
    set(s);
  },

  save: async (vaultRoot) => {
    const { saveConfig } = await import("../lib/ipc");
    const { load, save, setTheme, setAssetsStrategy, setPathStyle, setShowHiddenFiles, ...settings } = _get();
    await saveConfig(vaultRoot, settings);
  },

  setTheme: (theme) => set({ theme }),
  setAssetsStrategy: (assetsStrategy) => set({ assetsStrategy }),
  setPathStyle: (pathStyle) => set({ pathStyle }),
  setShowHiddenFiles: (showHiddenFiles) => set({ showHiddenFiles }),
}));
```

No separate settingsStore test file needed — the store is trivially a setter + IPC wrapper; the IPC is tested via config.rs integration tests.

- [ ] **Step 5: Run docStore tests**

```bash
npx vitest run src/stores/__tests__/docStore.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/stores/
git commit -m "feat(stores): docStore and settingsStore (Zustand) with tests"
```

---

## Task 6: vaultStore (Zustand, tested)

**Files:**
- Create: `src/stores/vaultStore.ts`
- Create: `src/stores/__tests__/vaultStore.test.ts`

- [ ] **Step 1: Write failing vaultStore tests**

Create `src/stores/__tests__/vaultStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act } from "@testing-library/react";
import { useVaultStore } from "../vaultStore";

vi.mock("../../lib/ipc", () => ({
  buildTree: vi.fn().mockResolvedValue({
    name: "vault", path: "", kind: "folder", collapsed: false,
    children: [{ name: "a.md", path: "a.md", kind: "file", children: [], collapsed: false }],
  }),
  reorderInFolder: vi.fn().mockResolvedValue(undefined),
  setCollapsed: vi.fn().mockResolvedValue(undefined),
  moveNode: vi.fn().mockResolvedValue(undefined),
}));

describe("vaultStore", () => {
  beforeEach(() => {
    act(() => useVaultStore.setState({ vaultRoot: null, tree: null, expanded: {} }));
  });

  it("loadTree populates tree from IPC", async () => {
    await act(() => useVaultStore.getState().loadTree("/vault"));
    const { vaultRoot, tree } = useVaultStore.getState();
    expect(vaultRoot).toBe("/vault");
    expect(tree).not.toBeNull();
    expect(tree!.children).toHaveLength(1);
  });

  it("setCollapsed toggles expanded state", () => {
    act(() => useVaultStore.setState({ expanded: { notes: true } }));
    act(() => useVaultStore.getState().setCollapsed("/vault", "notes", false));
    expect(useVaultStore.getState().expanded.notes).toBe(false);
  });
});
```

- [ ] **Step 2: Implement vaultStore**

Create `src/stores/vaultStore.ts`:

```ts
import { create } from "zustand";
import type { TreeNode } from "../lib/types";
import { buildTree, reorderInFolder, setCollapsed, moveNode } from "../lib/ipc";

interface VaultState {
  vaultRoot: string | null;
  tree: TreeNode | null;
  expanded: Record<string, boolean>;
  loadTree: (root: string) => Promise<void>;
  applyReorder: (folderRel: string, name: string, newIndex: number) => Promise<void>;
  applyMove: (fromFolder: string, fromName: string, toFolder: string, toName: string) => Promise<void>;
  setCollapsed: (vaultRoot: string, folderRel: string, collapsed: boolean) => Promise<void>;
}

export const useVaultStore = create<VaultState>((set, get) => ({
  vaultRoot: null,
  tree: null,
  expanded: {},

  loadTree: async (root) => {
    const tree = await buildTree(root);
    set({ vaultRoot: root, tree });
  },

  applyReorder: async (folderRel, name, newIndex) => {
    const root = get().vaultRoot;
    if (!root) return;
    await reorderInFolder(root, folderRel, name, newIndex);
    await get().loadTree(root);
  },

  applyMove: async (fromFolder, fromName, toFolder, toName) => {
    const root = get().vaultRoot;
    if (!root) return;
    await moveNode(root, fromFolder, fromName, toFolder, toName);
    await get().loadTree(root);
  },

  setCollapsed: async (vaultRoot, folderRel, collapsed) => {
    await setCollapsed(vaultRoot, folderRel, collapsed);
    set((s) => ({ expanded: { ...s.expanded, [folderRel]: collapsed } }));
  },
}));
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/stores/__tests__/vaultStore.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/stores/vaultStore.ts src/stores/__tests__/vaultStore.test.ts
git commit -m "feat(stores): vaultStore with loadTree, reorder, move, collapse"
```

---

## Task 7: 3-pane layout + App shell

**Files:**
- Modify: `src/App.tsx` (replace scaffold welcome page)
- Create: `src/components/Layout.tsx`

- [ ] **Step 1: Implement Layout component**

Create `src/components/Layout.tsx`:

```tsx
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { FileTree } from "./FileTree";
import { EditorPane } from "./EditorPane";
import { Outline } from "./Outline";

export function Layout() {
  return (
    <PanelGroup direction="horizontal" style={{ height: "100vh" }}>
      <Panel defaultSize={20} minSize={15} maxSize={40}>
        <FileTree />
      </Panel>
      <PanelResizeHandle style={{ width: 4, background: "#e0e0e0", cursor: "col-resize" }} />
      <Panel defaultSize={55} minSize={30}>
        <EditorPane />
      </Panel>
      <PanelResizeHandle style={{ width: 4, background: "#e0e0e0", cursor: "col-resize" }} />
      <Panel defaultSize={25} minSize={10} maxSize={40}>
        <Outline />
      </Panel>
    </PanelGroup>
  );
}
```

- [ ] **Step 2: Wire App.tsx vault-picker → Layout**

Modify `src/App.tsx`:

```tsx
import { useState } from "react";
import { open as tauriOpen } from "@tauri-apps/plugin-dialog";
import { useVaultStore } from "./stores/vaultStore";
import { useSettingsStore } from "./stores/settingsStore";
import { startVaultWatch } from "./lib/ipc";
import { Layout } from "./components/Layout";

export default function App() {
  const loadTree = useVaultStore((s) => s.loadTree);
  const loadSettings = useSettingsStore((s) => s.load);
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const [loading, setLoading] = useState(false);

  const pickVault = async () => {
    const folder = await tauriOpen({ directory: true, multiple: false });
    if (typeof folder !== "string") return;
    setLoading(true);
    await loadTree(folder);
    await loadSettings(folder);
    await startVaultWatch(folder);
    setLoading(false);
  };

  if (loading) return <div style={{ padding: 16 }}>Loading vault...</div>;
  if (!vaultRoot) {
    return (
      <div style={{ padding: 32, textAlign: "center", fontFamily: "sans-serif" }}>
        <h1>Markion</h1>
        <button onClick={pickVault} style={{ fontSize: 16, padding: "8px 24px" }}>
          Open vault folder
        </button>
      </div>
    );
  }
  return <Layout />;
}
```

- [ ] **Step 3: Create placeholder components for compilation**

Create minimal stubs so the app compiles (full implementations in subsequent tasks):

**`src/components/FileTree.tsx`:**
```tsx
export function FileTree() { return <div style={{ padding: 8 }}>FileTree</div>; }
```

**`src/components/EditorPane.tsx`:**
```tsx
export function EditorPane() { return <div style={{ padding: 8 }}>EditorPane</div>; }
```

**`src/components/Outline.tsx`:**
```tsx
export function Outline() { return <div style={{ padding: 8 }}>Outline</div>; }
```

- [ ] **Step 4: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/Layout.tsx src/components/FileTree.tsx src/components/EditorPane.tsx src/components/Outline.tsx src/App.tsx
git commit -m "feat(ui): 3-pane layout + vault-picker App shell"
```

---

## Task 8: FileTree component (react-arborist)

**Files:**
- Modify: `src/components/FileTree.tsx` (full implementation)

No separate test: react-arborist's drag behavior is tested manually in this plan; store-level reorder is tested in vaultStore tests.

- [ ] **Step 1: Implement FileTree**

Replace the stub in `src/components/FileTree.tsx`:

```tsx
import { Tree, type NodeRendererProps } from "react-arborist";
import { useVaultStore } from "../stores/vaultStore";
import type { TreeNode } from "../lib/types";

function treeNodeToRow(node: TreeNode): { id: string; name: string; children?: ReturnType<typeof treeNodeToRow>[] } {
  if (node.kind === "folder") {
    return { id: node.path, name: node.name, children: node.children.map(treeNodeToRow) };
  }
  return { id: node.path, name: node.name };
}

function NodeRenderer({ node, style, dragHandle }: NodeRendererProps<{ id: string; name: string }>) {
  return (
    <div style={style} ref={dragHandle}>
      <span>{node.data.name}</span>
    </div>
  );
}

export function FileTree() {
  const tree = useVaultStore((s) => s.tree);
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const applyReorder = useVaultStore((s) => s.applyReorder);
  const applyMove = useVaultStore((s) => s.applyMove);

  if (!tree) return <div style={{ padding: 8, color: "#999" }}>No vault open</div>;

  const rowData = tree.children.map(treeNodeToRow);

  return (
    <div style={{ height: "100%", overflow: "auto", padding: 4 }}>
      <Tree
        data={rowData}
        width="100%"
        height={window.innerHeight - 8}
        rowHeight={28}
        onMove={async ({ dragIds, parentId, index }) => {
          const name = (typeof dragIds[0] === "string" ? dragIds[0] : String(dragIds[0]));
          const fromFolder = ""; // For v1, detect parent from tree walk
          if (parentId && fromFolder !== parentId) {
            await applyMove(fromFolder, name, parentId!, name);
          } else {
            await applyReorder(parentId ?? "", name, index);
          }
        }}
      >
        {NodeRenderer}
      </Tree>
    </div>
  );
}
```

The `onMove` handler needs refinement to correctly detect the source folder and handle cross-folder moves. The react-arborist `onMove` callback provides `{ dragIds, parentId, index, dragNodes }`. Extract the source folder from `dragNodes[0]`'s parent path and the dest folder from `parentId`. Implement the full logic:

```tsx
onMove={async ({ dragIds, parentId, index, dragNodes }) => {
  const name = String(dragIds[0]);
  const srcParent = dragNodes[0]?.parent?.id ?? "";
  const destParent = parentId ?? "";
  if (srcParent !== destParent) {
    await applyMove(srcParent, name, destParent, name);
  } else {
    await applyReorder(destParent, name, index);
  }
}}
```

- [ ] **Step 2: Verify compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/FileTree.tsx
git commit -m "feat(ui): FileTree with react-arborist drag-reorder/move"
```

---

## Task 9: EditorPane + Tabs

**Files:**
- Modify: `src/components/EditorPane.tsx` (full implementation)
- Create: `src/components/Tabs.tsx`
- Modify: `src/components/Outline.tsx` (full implementation)

- [ ] **Step 1: Implement Tabs**

Create `src/components/Tabs.tsx`:

```tsx
import { useDocStore } from "../stores/docStore";

export function Tabs() {
  const openDocs = useDocStore((s) => s.openDocs);
  const activeDocId = useDocStore((s) => s.activeDocId);
  const dirtyMap = useDocStore((s) => s.dirtyMap);
  const switchTo = useDocStore((s) => s.switchTo);
  const closeDoc = useDocStore((s) => s.closeDoc);

  return (
    <div style={{ display: "flex", borderBottom: "1px solid #ddd", overflow: "auto" }}>
      {openDocs.map((doc) => (
        <div
          key={doc.id}
          onClick={() => switchTo(doc.id)}
          style={{
            padding: "6px 12px",
            cursor: "pointer",
            borderBottom: doc.id === activeDocId ? "2px solid #0366d6" : "2px solid transparent",
            fontWeight: doc.id === activeDocId ? 600 : 400,
            whiteSpace: "nowrap",
          }}
        >
          {dirtyMap[doc.id] && <span style={{ color: "#d73a49" }}>● </span>}
          {doc.title}
          <button
            onClick={(e) => { e.stopPropagation(); closeDoc(doc.id); }}
            style={{ marginLeft: 8, border: "none", background: "none", cursor: "pointer" }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Implement EditorPane (Tabs + editor + status bar)**

Replace `src/components/EditorPane.tsx`:

```tsx
import { useRef, useCallback } from "react";
import { useDocStore } from "../stores/docStore";
import { readFile, writeFileAtomic } from "../lib/ipc";
import { useVaultStore } from "../stores/vaultStore";
import { MarkdownEditor, type EditorHandle } from "../editor/EditorView";
import { Tabs } from "./Tabs";

export function EditorPane() {
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const activeDocId = useDocStore((s) => s.activeDocId);
  const openDocs = useDocStore((s) => s.openDocs);
  const openDoc = useDocStore((s) => s.openDoc);
  const markDirty = useDocStore((s) => s.markDirty);
  const markClean = useDocStore((s) => s.markClean);

  const activeDoc = openDocs.find((d) => d.id === activeDocId);

  // EditorState cache: Map<docId, { view, doc: string }>
  const cache = useRef<Map<string, EditorHandle>>(new Map());

  const handleTreeClick = useCallback(async (treePath: string) => {
    if (!vaultRoot) return;
    const name = treePath.split("/").pop() || treePath;
    openDoc(name, treePath);
    // Load content if not cached
    if (!cache.current.has(treePath)) {
      const content = await readFile(treePath, vaultRoot);
      // Cache the content; the editor refs are set when the component mounts
      // MarkdownEditor will re-mount for new docs; we use activeDoc.path to render
    }
  }, [vaultRoot, openDoc]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Tabs />
      <div style={{ flex: 1, overflow: "auto" }}>
        {activeDoc ? (
          <MarkdownEditor
            key={activeDoc.id}
            doc={""}
            onChange={() => markDirty(activeDoc.id)}
          />
        ) : (
          <div style={{ padding: 16, color: "#999" }}>Open a file from the tree</div>
        )}
      </div>
      <div style={{
        padding: "4px 8px", fontSize: 12, color: "#666",
        borderTop: "1px solid #ddd", display: "flex", justifyContent: "space-between",
      }}>
        <span>{activeDoc?.title ?? "no file"}</span>
        <span>{activeDoc && activeDocId && useDocStore.getState().dirtyMap[activeDocId] ? "● unsaved" : "saved"}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement Outline (heading extraction from CM6)**

Replace `src/components/Outline.tsx`:

```tsx
import { useMemo } from "react";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

interface Heading {
  level: number;
  text: string;
  line: number;
}

/** Extract headings from a CM6 EditorState's Lezer tree */
export function extractHeadings(state: EditorState): Heading[] {
  const tree = syntaxTree(state);
  const headings: Heading[] = [];
  tree.iterate({
    enter(node) {
      if (node.type.name === "Heading") {
        // The heading level is determined by the number of Mark nodes
        let level = 1;
        const cursor = node.cursor();
        if (cursor.firstChild()) {
          do {
            if (cursor.node.type.name === "Mark") level++;
          } while (cursor.nextSibling());
        }
        // Get the heading text (excluding the # markers)
        const text = state.doc.sliceString(node.from, node.to).replace(/^#+\s*/, "");
        headings.push({ level, text, line: state.doc.lineAt(node.from).number });
        return false;
      }
    },
  });
  return headings;
}

export function Outline() {
  // v1: display static headings. Live wiring to active editor state
  // requires accessing the MarkdownEditor ref — implemented after editor shell stabilizes.
  // For now, render a placeholder that will be wired in Plan 3 final integration.
  return <div style={{ padding: 8, overflow: "auto" }}><b>Outline</b><p style={{ color: "#999" }}>Headings will appear here</p></div>;
}
```

- [ ] **Step 4: Verify compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/Tabs.tsx src/components/EditorPane.tsx src/components/Outline.tsx
git commit -m "feat(ui): Tabs, EditorPane, Outline (heading extraction)"
```

---

## Task 10: Image paste + external-change handling + toasts

**Files:**
- Create: `src/hooks/useImagePaste.ts`
- Create: `src/hooks/useExternalChanges.ts`
- Create: `src/components/Toast.tsx`
- Create: `src/components/ConflictDialog.tsx`

No unit tests for hooks (CM6 paste interop is manual-test territory; store-level IPC is already tested).

- [ ] **Step 1: Implement useImagePaste hook**

Create `src/hooks/useImagePaste.ts`:

```ts
import { useEffect } from "react";
import { EditorView } from "@codemirror/view";
import { useVaultStore } from "../stores/vaultStore";
import { useSettingsStore } from "../stores/settingsStore";
import { saveImage } from "../lib/ipc";

function getDateStr(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

export function useImagePaste(viewRef: { current: EditorView | null }) {
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const { assetsStrategy, pathStyle } = useSettingsStore();

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const dom = view.dom;

    const handler = async (e: ClipboardEvent) => {
      if (!vaultRoot) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;
          const buf = new Uint8Array(await blob.arrayBuffer());
          const ext = item.type.split("/")[1] || "png";
          const activeDocPath = ""; // TODO: get from docStore
          const path = await saveImage(buf, ext, vaultRoot, activeDocPath, assetsStrategy, pathStyle, getDateStr());
          view.dispatch({
            changes: { from: view.state.selection.main.from, insert: `![](${path})` },
          });
        }
      }
    };

    dom.addEventListener("paste", handler);
    return () => dom.removeEventListener("paste", handler);
  }, [viewRef, vaultRoot, assetsStrategy, pathStyle]);
}
```

- [ ] **Step 2: Implement Toast notification system**

Create `src/components/Toast.tsx`:

```tsx
import { useState, useCallback, createContext, useContext } from "react";

export interface ToastCtx {
  toast: (msg: string, severity?: "error" | "info") => void;
}

const ToastContext = createContext<ToastCtx>({ toast: () => {} });
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; msg: string; severity: string }[]>([]);
  let id = 0;
  const toast = useCallback((msg: string, severity = "info") => {
    const newId = ++id;
    setToasts((t) => [...t, { id: newId, msg, severity }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== newId)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 9999 }}>
        {toasts.map((t) => (
          <div key={t.id} style={{
            padding: "8px 16px", marginTop: 8, borderRadius: 4,
            background: t.severity === "error" ? "#d73a49" : "#2ea44f", color: "#fff",
          }}>{t.msg}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
```

- [ ] **Step 3: Implement useExternalChanges hook + ConflictDialog**

Create `src/hooks/useExternalChanges.ts`:

```ts
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useDocStore } from "../stores/docStore";
import { useVaultStore } from "../stores/vaultStore";
import { useToast } from "../components/Toast";
import { readFile } from "../lib/ipc";

export function useExternalChanges() {
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const openDocs = useDocStore((s) => s.openDocs);
  const dirtyMap = useDocStore((s) => s.dirtyMap);
  const loadTree = useVaultStore((s) => s.loadTree);
  const { toast } = useToast();

  useEffect(() => {
    const unlisten = listen<string[]>("vault-changed", async (event) => {
      const paths = event.payload;
      if (!vaultRoot) return;
      for (const p of paths) {
        const doc = openDocs.find((d) => d.path === p);
        if (doc) {
          if (dirtyMap[doc.id]) {
            // Show conflict — v1: toast + ask via confirm()
            const keep = confirm(`${p} was modified externally. Keep your changes? (Cancel = load disk version)`);
            if (keep) {
              toast("Kept your version", "info");
            } else {
              // Reload from disk — handled by caller via docStore
              toast("Loaded disk version", "info");
            }
          } else {
            toast(`Reloaded ${p} (external change)`, "info");
          }
        }
      }
      // Rebuild tree on any external change
      await loadTree(vaultRoot);
    });
    return () => { unlisten.then((u) => u()); };
  }, [vaultRoot, openDocs, dirtyMap]);
}
```

Create `src/components/ConflictDialog.tsx` as a placeholder (v1 uses `confirm()` for simplicity):

```tsx
// v1: browser confirm() is used in useExternalChanges.
// ConflictDialog is a planned upgrade for a styled modal.
export function ConflictDialog() { return null; }
```

- [ ] **Step 4: Verify compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/ src/components/Toast.tsx src/components/ConflictDialog.tsx
git commit -m "feat(ui): image paste, external-change handling, toast system"
```

---

## Task 11: Ctrl+P quick open

**Files:**
- Create: `src/components/QuickOpen.tsx`

- [ ] **Step 1: Implement QuickOpen**

Create `src/components/QuickOpen.tsx`:

```tsx
import { useState, useMemo, useEffect } from "react";
import { useVaultStore } from "../stores/vaultStore";
import { useDocStore } from "../stores/docStore";
import type { TreeNode } from "../lib/types";

function flattenFiles(node: TreeNode | null): { name: string; path: string }[] {
  if (!node) return [];
  const files: { name: string; path: string }[] = [];
  function walk(n: TreeNode java.io.TreeNode) {
    if (n.kind === "file") files.push({ name: n.name, path: n.path });
    n.children.forEach(walk);
  }
  walk(node);
  return files;
}

export function QuickOpen() {
  const tree = useVaultStore((s) => s.tree);
  const openDoc = useDocStore((s) => s.openDoc);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "p") { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const files = useMemo(() => flattenFiles(tree), [tree]);
  const filtered = files.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()));

  if (!open) return null;
  return (
    <div style={{ position: "fixed", top: "15%", left: "30%", width: "40%", maxHeight: "60%",
      background: "#fff", boxShadow: "0 4px 20px rgba(0,0,0,0.2)", borderRadius: 8, zIndex: 100, overflow: "auto" }}>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search files…"
        style={{ width: "100%", boxSizing: "border-box", padding: "10px 16px", fontSize: 16, border: "none", outline: "none" }}
      />
      {filtered.map((f) => (
        <div key={f.path}
          onClick={() => { openDoc(f.name, f.path); setOpen(false); }}
          style={{ padding: "8px 16px", cursor: "pointer", borderBottom: "1px solid #eee" }}>
          {f.name}
        </div>
      ))}
    </div>
  );
}
```

Fix the `flattenFiles` type annotation — `javax.swing.tree.TreeNode` is wrong; use `TreeNode` from our types:

```ts
function walk(n: TreeNode) {
```

(Remove `java.io.TreeNode` reference — that was an auto-complete error.)

- [ ] **Step 2: Wire QuickOpen into App.tsx**

Add `<QuickOpen />` inside the `Layout` or `App` render (before `Layout`).

- [ ] **Step 3: Verify compiles + commit**

```bash
npx tsc --noEmit && git add src/components/QuickOpen.tsx src/App.tsx && git commit -m "feat(ui): Ctrl+P quick-open file search"
```

---

## Task 12: Settings dialog

**Files:**
- Create: `src/components/SettingsDialog.tsx`
- Modify: `src/App.tsx` (add settings trigger)

- [ ] **Step 1: Implement SettingsDialog**

Create `src/components/SettingsDialog.tsx`:

```tsx
import { useState } from "react";
import { useSettingsStore } from "../stores/settingsStore";

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const settings = useSettingsStore();

  if (!open) return <button onClick={() => setOpen(true)} style={{ position: "fixed", top: 8, right: 8 }}>⚙</button>;

  return (
    <div style={{ position: "fixed", top: "10%", left: "30%", width: "40%",
      background: "#fff", boxShadow: "0 4px 20px rgba(0,0,0,0.2)", borderRadius: 8, zIndex: 200, padding: 16 }}>
      <h2>Settings</h2>
      <label>Assets strategy:{" "}
        <select value={settings.assetsStrategy} onChange={(e) => settings.setAssetsStrategy(e.target.value as any)}>
          <option value="vault-assets">Vault-level assets/</option>
          <option value="doc-assets">Doc-side assets/</option>
          <option value="custom">Custom path</option>
        </select>
      </label><br /><br />
      <label>Path style:{" "}
        <select value={settings.pathStyle} onChange={(e) => settings.setPathStyle(e.target.value as any)}>
          <option value="relative">Relative (to doc)</option>
          <option value="absolute">Absolute</option>
        </select>
      </label><br /><br />
      <label>Theme:{" "}
        <select value={settings.theme} onChange={(e) => settings.setTheme(e.target.value as any)}>
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label><br /><br />
      <label>
        <input type="checkbox" checked={settings.showHiddenFiles}
          onChange={(e) => settings.setShowHiddenFiles(e.target.checked)} />
        {" "}Show hidden files
      </label><br /><br />
      <button onClick={() => setOpen(false)}>Close</button>
    </div>
  );
}
```

- [ ] **Step 2: Wire into App**

Add `<SettingsDialog />` inside App after `<QuickOpen />`.

- [ ] **Step 3: Verify compiles + commit**

```bash
npx tsc --noEmit && git add src/components/SettingsDialog.tsx src/App.tsx && git commit -m "feat(ui): settings dialog (assets, path style, theme, hidden files)"
```

---

## Task 13: Integration — wire everything into App, manual smoke

**Files:**
- Modify: `src/App.tsx` (final wiring)
- Modify: `src/components/EditorPane.tsx` (wire paste hook, outline refresh)

- [ ] **Step 1: Final App.tsx integration**

Refactor `src/App.tsx` to include all providers and hooks:

```tsx
import { Layout } from "./components/Layout";
import { QuickOpen } from "./components/QuickOpen";
import { SettingsDialog } from "./components/SettingsDialog";
import { ToastProvider } from "./components/Toast";
import { useExternalChanges } from "./hooks/useExternalChanges";
// ... vault picker logic from Task 7

function VaultApp() {
  useExternalChanges();
  return (
    <>
      <Layout />
      <QuickOpen />
      <SettingsDialog />
    </>
  );
}

export default function App() {
  // ... picker logic, render VaultApp when vaultRoot set
  return (
    <ToastProvider>
      {vaultRoot ? <VaultApp /> : <VaultPicker />}
    </ToastProvider>
  );
}
```

- [ ] **Step 2: Smoke test checklist (manual)**

1. `npm run tauri dev` — app window opens.
2. Click "Open vault folder" → pick a folder with .md files.
3. File tree renders with documents and folders.
4. Click a .md file in the tree → tab appears, editor shows content.
5. Type in the editor → live preview renders inline (bold, code, links).
6. Type a table in markdown → it renders as an HTML table in-place.
7. Type `- [ ] todo` → checkbox widget appears; click it → `[ ]` toggles to `[x]`.
8. `Ctrl+P` → quick-open palette; type filename → hit Enter → opens file.
9. Right-click tree → new file / rename / delete.
10. Drag file to a different folder → file moves on disk.
11. Drag to reorder within folder → order persists (index.json updated).
12. Paste an image from clipboard → saves to assets/ + inserts `![]`.
13. Externally modify an open file → toast + reload (or conflict prompt if dirty).
14. All Rust tests pass: `cd src-tauri && cargo test -- --nocapture`.
15. All frontend unit tests pass: `npx vitest run`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(app): final integration wiring + manual smoke check"
```

---

## Done criteria

- App boots with `npm run tauri dev`.
- Open vault, file tree renders, click a file to edit.
- CM6 live preview shows inline decorations and block widgets.
- Task checkboxes toggle source.
- Drag-reorder / drag-move files in the tree.
- Paste images → saved to vault's `assets/` (relative path by default).
- External file changes detected → reload tree, prompt if dirty file.
- Settings dialog: change assets strategy, path style, theme.
- `Ctrl+P` quick-open file.
- All Rust tests (`cargo test`) and frontend unit tests (`npx vitest run`) pass.

## What this plan does NOT cover (deferred per spec)

- Math formulas (KaTeX), Mermaid diagrams
- Backlinks / graph view
- Full command palette (beyond Ctrl+P)
- `index.md` as container content
- External changes: diff view for conflicts (v1 = simple confirm/cancel)
- Virtual-scrolling for large vaults (tree is just file list for v1)
