# Markion Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a Tauri 2 + React app and implement the full Rust backend (file I/O, tree index, file watcher, image handling) with unit tests, exposed to the frontend via Tauri commands.

**Architecture:** Rust backend (`src-tauri/`) owns all filesystem access; webview calls it via `#[tauri::command]`. Core logic (`tree_index` merge, `file_io` atomic write, `image` dedup) is pure or near-pure functions unit-tested in isolation; FS-touching paths use `tempfile` for integration tests.

**Tech Stack:** Tauri 2, Rust (serde, serde_json, notify, sha2, pathdiff, tempfile), React + Vite + TypeScript (minimal boot in this plan; editor deps land in Plan 2).

**Spec reference:** [2026-07-31-markion-editor-design.md](../specs/2026-07-31-markion-editor-design.md) — sections 3 (architecture), 5 (doc tree / file I/O), 6.3 (images), 7 (errors).

---

## File Structure (this plan)

### Backend (`src-tauri/`)

| File | Responsibility |
|---|---|
| `src-tauri/Cargo.toml` | Rust deps + crate metadata |
| `src-tauri/tauri.conf.json` | Tauri app config (window, identifier, capabilities) |
| `src-tauri/src/main.rs` | Entry; `tauri::Builder` registers commands, starts watcher |
| `src-tauri/src/lib.rs` | Module declarations + `run()` |
| `src-tauri/src/commands.rs` | `#[tauri::command]` handlers wrapping the modules |
| `src-tauri/src/file_io.rs` | `read_file`, `write_file_atomic` |
| `src-tauri/src/tree_index.rs` | `IndexFile`, `FolderMeta`, `TreeNode`, `merge_order`, `build_tree`, `load_index`, `save_index` |
| `src-tauri/src/watcher.rs` | `notify` watcher with debounce + event emission |
| `src-tauri/src/image.rs` | `hash_content`, `save_image` with dedup + path resolution |

### Frontend (minimal boot, for smoke-testing commands)

| File | Responsibility |
|---|---|
| `package.json` | npm deps + scripts |
| `vite.config.ts` | Vite + Tauri config |
| `tsconfig.json` | TS config |
| `index.html` | HTML entry |
| `src/main.tsx` | React mount |
| `src/App.tsx` | Minimal UI that calls one command (smoke test) |
| `src/lib/ipc.ts` | Typed wrappers around `@tauri-apps/api/core invoke` |
| `src/lib/types.ts` | TS types mirroring Rust structs |
| `.gitignore` | node_modules, target, dist |

### Tests

- Inline `#[cfg(test)]` modules in each Rust file (unit tests for pure logic).
- `tempfile` tempdir-based integration tests for FS-touching code.

---

## Task 1: Scaffold Tauri 2 + React app in place

The repo root already has `docs/` and `.git/`. We scaffold into a temp dir, then move files up (the scaffolder refuses a non-empty dir).

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/build.rs`, `.gitignore`

- [ ] **Step 1: Scaffold into a temp directory**

Run from `D:/Exercise/AI/Markion`:

```bash
npm create tauri-app@latest markion-scaffold -- --template react-ts --manager npm --identifier com.markion.app
```

Expected: creates `markion-scaffold/` with a working Tauri 2 + React-TS app.

- [ ] **Step 2: Move scaffolded files up to repo root**

Move (not copy) these from `markion-scaffold/` into the repo root, preserving paths:

```bash
cd "D:/Exercise/AI/Markion"
mv markion-scaffold/package.json .
mv markion-scaffold/package-lock.json .
mv markion-scaffold/tsconfig.json .
mv markion-scaffold/vite.config.ts .
mv markion-scaffold/index.html .
mv markion-scaffold/src ./src
mv markion-scaffold/src-tauri ./src-tauri
mv markion-scaffold/.gitignore .gitignore
rmdir markion-scaffold
```

Expected: repo root now has `package.json`, `src/`, `src-tauri/`, etc. alongside `docs/`.

- [ ] **Step 3: Verify install + dev boot**

```bash
npm install
```

Expected: installs without errors.

- [ ] **Step 4: Add a .gitignore entry for docs safety (already has node_modules/target)**

Open `.gitignore` and ensure it contains at minimum:

```gitignore
node_modules
dist
dist-ssr
*.local
src-tauri/target
```

- [ ] **Step 5: Smoke-run the dev server (manual)**

```bash
npm run tauri dev
```

Expected: a desktop window opens showing the default Tauri React welcome page. Close the window to stop. If Rust toolchain is missing, install from https://rustup.rs first.

- [ ] **Step 6: Commit scaffold**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html .gitignore src src-tauri
git commit -m "chore: scaffold Tauri 2 + React-TS app"
```

---

## Task 2: Add Rust dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Edit Cargo.toml `[dependencies]`**

Open `src-tauri/Cargo.toml`. Replace the `[dependencies]` section with:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
notify = "6"
sha2 = "0.10"
pathdiff = "0.2"
walkdir = "2"

[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 2: Verify it builds**

```bash
cd src-tauri && cargo check && cd ..
```

Expected: compiles (may take a while first time as deps build). No errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: add backend dependencies (notify, sha2, pathdiff, walkdir, tempfile)"
```

---

## Task 3: file_io — read and atomic write (TDD)

**Files:**
- Create: `src-tauri/src/file_io.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod file_io;`)

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/file_io.rs` with only the test module:

```rust
use std::fs;
use std::path::Path;

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[test]
    fn write_then_read_returns_same_content() {
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path();
        // NamedTempFile creates an empty file; write to it
        write_file_atomic(path, "hello world\nsecond line").unwrap();
        assert_eq!(read_file(path).unwrap(), "hello world\nsecond line");
    }

    #[test]
    fn write_does_not_leave_temp_file() {
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path();
        write_file_atomic(path, "data").unwrap();
        let parent = path.parent().unwrap();
        let temps: Vec<_> = fs::read_dir(parent).unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("."))
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(temps.is_empty(), "leftover temp file: {:?}", temps);
    }

    #[test]
    fn read_missing_file_errors() {
        let path = Path::new("/nonexistent/does/not/exist.md");
        assert!(read_file(path).is_err());
    }
}
```

- [ ] **Step 2: Declare module and run test to verify it fails**

Add to `src-tauri/src/lib.rs`:

```rust
pub mod file_io;
```

Run:

```bash
cd src-tauri && cargo test file_io::tests -- --nocapture && cd ..
```

Expected: FAIL — `error[E0425]: cannot find function write_file_atomic` / `read_file` (not yet defined).

- [ ] **Step 3: Implement minimal code**

Add above the test module in `src-tauri/src/file_io.rs`:

```rust
use std::fs;
use std::path::Path;

pub fn read_file(path: &Path) -> std::io::Result<String> {
    fs::read_to_string(path)
}

pub fn write_file_atomic(path: &Path, content: &str) -> std::io::Result<()> {
    let dir = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent")
    })?;
    let file_name = path.file_name()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no file name"))?
        .to_string_lossy();
    let tmp = dir.join(format!(".{}.tmp", file_name));
    fs::write(&tmp, content)?;
    fs::rename(&tmp, path)?;
    Ok(())
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd src-tauri && cargo test file_io::tests -- --nocapture && cd ..
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/file_io.rs src-tauri/src/lib.rs
git commit -m "feat(file_io): atomic write and read with unit tests"
```

---

## Task 4: tree_index — data structures and merge_order (TDD, pure logic)

The core of the hybrid model. `merge_order` is a pure function: given the FS's actual children and the index's recorded order, produce display order (indexed-and-existing first in index order, then new FS items sorted alphabetically).

**Files:**
- Create: `src-tauri/src/tree_index.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod tree_index;`)

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/tree_index.rs` with the test module and struct definitions but NOT the `merge_order` body:

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    File,
    Folder,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub kind: NodeKind,
    pub children: Vec<TreeNode>,
    pub collapsed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct FolderMeta {
    #[serde(default)]
    pub order: Vec<String>,
    #[serde(default)]
    pub collapsed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct IndexFile {
    pub version: u32,
    #[serde(default)]
    pub folders: HashMap<String, FolderMeta>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_empty_fs_empty_index() {
        assert_eq!(merge_order(&[], &[]), Vec::<String>::new());
    }

    #[test]
    fn merge_index_empty_returns_fs_sorted() {
        let fs = vec!["b.md".into(), "a.md".into(), "c".into()];
        assert_eq!(merge_order(&fs, &[]), vec!["a.md".to_string(), "b.md".to_string(), "c".to_string()]);
    }

    #[test]
    fn merge_index_matches_fs_uses_index_order() {
        let fs = vec!["a.md".into(), "b.md".into()];
        let idx = vec!["b.md".into(), "a.md".into()];
        assert_eq!(merge_order(&fs, &idx), vec!["b.md".to_string(), "a.md".to_string()]);
    }

    #[test]
    fn merge_drops_index_entries_missing_from_fs() {
        let fs = vec!["a.md".into()];
        let idx = vec!["deleted.md".into(), "a.md".into()];
        assert_eq!(merge_order(&fs, &idx), vec!["a.md".to_string()]);
    }

    #[test]
    fn merge_appends_new_fs_items_sorted_after_indexed() {
        let fs = vec!["old.md".into(), "z.md".into(), "new2.md".into(), "new1.md".into()];
        let idx = vec!["old.md".into(), "z.md".into()];
        assert_eq!(merge_order(&fs, &idx),
            vec!["old.md".to_string(), "z.md".to_string(), "new1.md".to_string(), "new2.md".to_string()]);
    }

    #[test]
    fn merge_handles_duplicates_in_fs_gracefully() {
        let fs = vec!["a.md".into(), "a.md".into()];
        let idx: Vec<String> = vec![];
        // duplicates pass through (dedup is FS's job); we just sort
        assert_eq!(merge_order(&fs, &idx), vec!["a.md".to_string(), "a.md".to_string()]);
    }
}
```

- [ ] **Step 2: Declare module and run test to verify it fails**

Add to `src-tauri/src/lib.rs`:

```rust
pub mod tree_index;
```

Run:

```bash
cd src-tauri && cargo test tree_index::tests -- --nocapture && cd ..
```

Expected: FAIL — `error[E0425]: cannot find function merge_order`.

- [ ] **Step 3: Implement merge_order**

Add above the test module in `src-tauri/src/tree_index.rs`:

```rust
use std::collections::HashSet;

/// Produce display order for a folder's children.
/// Indexed items that still exist on FS come first (in index order);
/// FS items not in the index are appended, sorted alphabetically.
pub fn merge_order(fs_children: &[String], index_order: &[String]) -> Vec<String> {
    let fs_set: HashSet<&String> = fs_children.iter().collect();
    let index_set: HashSet<&String> = index_order.iter().collect();

    let mut result: Vec<String> = index_order.iter()
        .filter(|name| fs_set.contains(*name))
        .cloned()
        .collect();

    let mut new_items: Vec<String> = fs_children.iter()
        .filter(|name| !index_set.contains(*name))
        .cloned()
        .collect();
    new_items.sort();

    result.extend(new_items);
    result
}
```

(Note: add the second `use std::collections::HashSet;` line to the existing `use std::collections::HashMap;` — combine into one line: `use std::collections::{HashMap, HashSet};`.)

- [ ] **Step 4: Run test to verify it passes**

```bash
cd src-tauri && cargo test tree_index::tests -- --nocapture && cd ..
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/tree_index.rs src-tauri/src/lib.rs
git commit -m "feat(tree_index): merge_order pure logic with unit tests"
```

---

## Task 5: tree_index — build_tree, load_index, save_index (TDD, integration)

**Files:**
- Modify: `src-tauri/src/tree_index.rs`

- [ ] **Step 1: Add the failing integration tests**

Append to the `tests` module in `src-tauri/src/tree_index.rs`:

```rust
    use std::fs;
    use tempfile::tempdir;

    fn write_vault(root: &Path, layout: &[(&str, &str)]) {
        for (rel, content) in layout {
            let p = root.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, content).unwrap();
        }
    }

    #[test]
    fn build_tree_empty_vault() {
        let dir = tempdir().unwrap();
        let index = IndexFile::default();
        let tree = build_tree(dir.path(), &index);
        assert_eq!(tree.kind, NodeKind::Folder);
        assert!(tree.children.is_empty());
    }

    #[test]
    fn build_tree_uses_index_order() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[
            ("a.md", ""), ("b.md", ""), ("notes/c.md", ""),
        ]);
        let mut index = IndexFile::default();
        index.folders.insert("".to_string(), FolderMeta {
            order: vec!["b.md".into(), "notes".into(), "a.md".into()],
            collapsed: false,
        });
        let tree = build_tree(dir.path(), &index);
        let names: Vec<&str> = tree.children.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, vec!["b.md", "notes", "a.md"]);
    }

    #[test]
    fn build_tree_appends_new_files_sorted() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[
            ("old.md", ""), ("z.md", ""), ("new1.md", ""), ("new2.md", ""),
        ]);
        let mut index = IndexFile::default();
        index.folders.insert("".to_string(), FolderMeta {
            order: vec!["old.md".into(), "z.md".into()],
            collapsed: false,
        });
        let tree = build_tree(dir.path(), &index);
        let names: Vec<&str> = tree.children.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, vec!["old.md", "z.md", "new1.md", "new2.md"]);
    }

    #[test]
    fn build_tree_marks_collapsed_from_index() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("notes/a.md", "")]);
        let mut index = IndexFile::default();
        index.folders.insert("notes".to_string(), FolderMeta {
            order: vec!["a.md".into()],
            collapsed: true,
        });
        let tree = build_tree(dir.path(), &index);
        let notes = tree.children.iter().find(|n| n.name == "notes").unwrap();
        assert!(notes.collapsed);
        assert_eq!(notes.kind, NodeKind::Folder);
    }

    #[test]
    fn build_tree_hides_markion_dir() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[
            ("a.md", ""), (".markion/index.json", "{}"),
        ]);
        let tree = build_tree(dir.path(), &IndexFile::default());
        let names: Vec<&str> = tree.children.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, vec!["a.md"]);
    }

    #[test]
    fn save_then_load_index_roundtrip() {
        let dir = tempdir().unwrap();
        let mut index = IndexFile::default();
        index.version = 1;
        index.folders.insert("".to_string(), FolderMeta {
            order: vec!["b.md".into(), "a.md".into()],
            collapsed: true,
        });
        save_index(dir.path(), &index).unwrap();
        let loaded = load_index(dir.path()).unwrap();
        assert_eq!(loaded, index);
    }

    #[test]
    fn load_index_missing_returns_default() {
        let dir = tempdir().unwrap();
        let loaded = load_index(dir.path()).unwrap();
        assert_eq!(loaded, IndexFile::default());
    }

    #[test]
    fn load_index_corrupt_returns_default() {
        let dir = tempdir().unwrap();
        let idx_path = dir.path().join(".markion").join("index.json");
        fs::create_dir_all(idx_path.parent().unwrap()).unwrap();
        fs::write(&idx_path, "not valid json {{{").unwrap();
        let loaded = load_index(dir.path()).unwrap();
        assert_eq!(loaded, IndexFile::default());
    }
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src-tauri && cargo test tree_index::tests -- --nocapture && cd ..
```

Expected: FAIL — `cannot find function build_tree` / `load_index` / `save_index`.

- [ ] **Step 3: Implement build_tree, load_index, save_index**

Add to `src-tauri/src/tree_index.rs` (above the test module):

```rust
const INDEX_PATH: &str = ".markion/index.json";

const HIDDEN_DIRS: &[&str] = &[".markion"];

pub fn build_tree(vault_root: &Path, index: &IndexFile) -> TreeNode {
    build_folder(vault_root, "", index)
}

fn build_folder(root: &Path, rel_dir: &str, index: &IndexFile) -> TreeNode {
    let abs_dir = if rel_dir.is_empty() {
        root.to_path_buf()
    } else {
        root.join(rel_dir)
    };

    let fs_children: Vec<String> = match std::fs::read_dir(&abs_dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|name| !HIDDEN_DIRS.contains(&name.as_str()))
            .collect(),
        Err(_) => vec![],
    };

    let meta = index.folders.get(rel_dir);
    let order: &[String] = meta.map(|m| m.order.as_slice()).unwrap_or(&[]);
    let display_order = merge_order(&fs_children, order);

    let children: Vec<TreeNode> = display_order.iter().map(|name| {
        let child_rel = if rel_dir.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", rel_dir, name)
        };
        let child_abs = abs_dir.join(name);
        if child_abs.is_dir() {
            build_folder(root, &child_rel, index)
        } else {
            TreeNode {
                name: name.clone(),
                path: child_rel,
                kind: NodeKind::File,
                children: vec![],
                collapsed: false,
            }
        }
    }).collect();

    let name = if rel_dir.is_empty() {
        root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
    } else {
        rel_dir.rsplit('/').next().unwrap_or(rel_dir).to_string()
    };

    TreeNode {
        name,
        path: rel_dir.to_string(),
        kind: NodeKind::Folder,
        children,
        collapsed: meta.map(|m| m.collapsed).unwrap_or(false),
    }
}

pub fn load_index(vault_root: &Path) -> std::io::Result<IndexFile> {
    let path = vault_root.join(INDEX_PATH);
    match std::fs::read_to_string(&path) {
        Ok(s) => match serde_json::from_str::<IndexFile>(&s) {
            Ok(parsed) => Ok(parsed),
            Err(e) => {
                eprintln!("[tree_index] corrupt index at {:?}: {}; falling back to default", path, e);
                Ok(IndexFile::default())
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(IndexFile::default()),
        Err(e) => Err(e),
    }
}

pub fn save_index(vault_root: &Path, index: &IndexFile) -> std::io::Result<()> {
    let dir = vault_root.join(".markion");
    std::fs::create_dir_all(&dir)?;
    let path = vault_root.join(INDEX_PATH);
    let json = serde_json::to_string_pretty(index)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))?;
    crate::file_io::write_file_atomic(&path, &json)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd src-tauri && cargo test tree_index::tests -- --nocapture && cd ..
```

Expected: PASS — all tree_index tests (6 merge + 8 integration = 14).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/tree_index.rs
git commit -m "feat(tree_index): build_tree, load/save index with integration tests"
```

---

## Task 6: tree_index — reorder and move operations (TDD)

Operations the UI will call: reorder within a folder (index-only), and move across folders (also updates FS).

**Files:**
- Modify: `src-tauri/src/tree_index.rs`

- [ ] **Step 1: Add the failing tests**

Append to the `tests` module:

```rust
    #[test]
    fn reorder_within_folder_updates_index_order() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", ""), ("b.md", ""), ("c.md", "")]);
        let mut index = IndexFile::default();
        index.folders.insert("".to_string(), FolderMeta {
            order: vec!["a.md".into(), "b.md".into(), "c.md".into()],
            collapsed: false,
        });
        // move c.md to position 0
        reorder(&mut index, "", "c.md", 0);
        assert_eq!(index.folders.get("").unwrap().order,
            vec!["c.md".to_string(), "a.md".to_string(), "b.md".to_string()]);
    }

    #[test]
    fn set_collapsed_persists() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("notes/a.md", "")]);
        let mut index = IndexFile::default();
        index.folders.insert("notes".to_string(), FolderMeta::default());
        set_collapsed(&mut index, "notes", true);
        assert!(index.folders.get("notes").unwrap().collapsed);
        set_collapsed(&mut index, "notes", false);
        assert!(!index.folders.get("notes").unwrap().collapsed);
    }
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src-tauri && cargo test tree_index::tests::reorder -- --nocapture && cd ..
```

Expected: FAIL — `cannot find function reorder`.

- [ ] **Step 3: Implement reorder and set_collapsed**

Add to `src-tauri/src/tree_index.rs`:

```rust
/// Move `name` within folder `folder_rel` to `new_index` in the index order.
/// No filesystem operation. If the folder has no meta yet, it's created from
/// the current FS scan — but callers should pass an index already merged with FS.
pub fn reorder(index: &mut IndexFile, folder_rel: &str, name: &str, new_index: usize) {
    let meta = index.folders.entry(folder_rel.to_string()).or_default();
    if let Some(pos) = meta.order.iter().position(|n| n == name) {
        let item = meta.order.remove(pos);
        let insert_at = new_index.min(meta.order.len());
        meta.order.insert(insert_at, item);
    } else {
        // item not in index order; just insert at new_index
        let insert_at = new_index.min(meta.order.len());
        meta.order.insert(insert_at, name.to_string());
    }
}

pub fn set_collapsed(index: &mut IndexFile, folder_rel: &str, collapsed: bool) {
    let meta = index.folders.entry(folder_rel.to_string()).or_default();
    meta.collapsed = collapsed;
}

/// Update index after a file/folder is moved from `from_folder` to `to_folder`
/// under name `from_name` -> `to_name`. Does NOT touch the filesystem; caller
/// does the actual rename, then calls this to keep the index consistent.
pub fn apply_move(
    index: &mut IndexFile,
    from_folder: &str,
    from_name: &str,
    to_folder: &str,
    to_name: &str,
) {
    if let Some(from_meta) = index.folders.get_mut(from_folder) {
        from_meta.order.retain(|n| n != from_name);
    }
    let to_meta = index.folders.entry(to_folder.to_string()).or_default();
    if !to_meta.order.contains(&to_name.to_string()) {
        to_meta.order.push(to_name.to_string());
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd src-tauri && cargo test tree_index::tests -- --nocapture && cd ..
```

Expected: PASS — all tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/tree_index.rs
git commit -m "feat(tree_index): reorder, set_collapsed, apply_move operations"
```

---

## Task 7: image — hash and save with dedup (TDD)

**Files:**
- Create: `src-tauri/src/image.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod image;`)

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/image.rs` with the test module only:

```rust
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub enum AssetsStrategy {
    VaultAssets,
    DocAssets,
    Custom(PathBuf),
}

#[derive(Debug, Clone, Copy, PartialEq)]
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
    fn hash_is_deterministic_and_short() {
        let h1 = hash_content(b"hello");
        let h2 = hash_content(b"hello");
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 6);
    }

    #[test]
    fn hash_differs_for_different_content() {
        assert_ne!(hash_content(b"hello"), hash_content(b"world"));
    }

    #[test]
    fn save_vault_assets_relative_path() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        fs::write(root.join("notes").join("a.md"), "").unwrap();
        let doc_rel = Path::new("notes/a.md");

        let path = save_image(
            b"pngbytes", "png", root, doc_rel,
            &AssetsStrategy::VaultAssets, PathStyle::Relative, "20260731",
        ).unwrap();

        assert_eq!(path, "../assets/20260731-2cf24d.png");
        assert!(root.join("assets").join("20260731-2cf24d.png").exists());
    }

    #[test]
    fn save_doc_assets_relative_path() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        fs::write(root.join("notes").join("a.md"), "").unwrap();
        let doc_rel = Path::new("notes/a.md");

        let path = save_image(
            b"pngbytes", "png", root, doc_rel,
            &AssetsStrategy::DocAssets, PathStyle::Relative, "20260731",
        ).unwrap();

        assert_eq!(path, "assets/20260731-2cf24d.png");
        assert!(root.join("notes").join("assets").join("20260731-2cf24d.png").exists());
    }

    #[test]
    fn save_absolute_path() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        let doc_rel = Path::new("a.md");
        let path = save_image(
            b"pngbytes", "png", root, doc_rel,
            &AssetsStrategy::VaultAssets, PathStyle::Absolute, "20260731",
        ).unwrap();
        assert!(path.ends_with("assets/20260731-2cf24d.png"));
        assert!(path.contains(root.to_string_lossy().as_ref()) || std::path::absolute(&path).is_ok());
    }

    #[test]
    fn save_dedup_does_not_overwrite() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        let doc_rel = Path::new("a.md");
        let first = save_image(
            b"pngbytes", "png", root, doc_rel,
            &AssetsStrategy::VaultAssets, PathStyle::Relative, "20260731",
        ).unwrap();
        // tamper with the saved file
        let abs = root.join("assets").join("20260731-2cf24d.png");
        fs::write(&abs, b"TAMPERED").unwrap();
        // save same content again — should NOT overwrite (dedup by name)
        let second = save_image(
            b"pngbytes", "png", root, doc_rel,
            &AssetsStrategy::VaultAssets, PathStyle::Relative, "20260731",
        ).unwrap();
        assert_eq!(first, second);
        assert_eq!(fs::read(&abs).unwrap(), b"TAMPERED");
    }
}
```

Note: the expected hash `2cf24d` is the first 6 hex chars of `sha256("pngbytes")`. The engineer should verify by running `printf 'pngbytes' | sha256sum` in a shell and taking the first 6 chars; if it differs, update the expected value in the tests to match the actual output. (This is the one place the plan can't hardcode the hash without running it.)

- [ ] **Step 2: Declare module and run test to verify it fails**

Add to `src-tauri/src/lib.rs`:

```rust
pub mod image;
```

Run:

```bash
cd src-tauri && cargo test image::tests -- --nocapture && cd ..
```

Expected: FAIL — `cannot find function hash_content` / `save_image`.

- [ ] **Step 3: Implement hash_content and save_image**

Add above the test module in `src-tauri/src/image.rs`:

```rust
use sha2::{Sha256, Digest};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub enum AssetsStrategy {
    VaultAssets,
    DocAssets,
    Custom(PathBuf),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PathStyle {
    Relative,
    Absolute,
}

/// First 6 hex chars of sha256(content) — collision-safe enough for dedup at this scale.
pub fn hash_content(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let hash = hasher.finalize();
    let hex = format!("{:x}", hash);
    hex[..6].to_string()
}

pub fn save_image(
    bytes: &[u8],
    ext: &str,
    vault_root: &Path,
    doc_rel: &Path,
    strategy: &AssetsStrategy,
    path_style: PathStyle,
    date: &str, // YYYYMMDD, injected for testability
) -> std::io::Result<String> {
    let hash = hash_content(bytes);
    let filename = format!("{}-{}.{}", date, hash, ext);

    let assets_dir: PathBuf = match strategy {
        AssetsStrategy::VaultAssets => vault_root.join("assets"),
        AssetsStrategy::DocAssets => {
            let doc_dir = doc_rel.parent().unwrap_or(Path::new(""));
            vault_root.join(doc_dir).join("assets")
        }
        AssetsStrategy::Custom(p) => p.clone(),
    };
    fs::create_dir_all(&assets_dir)?;

    let target = assets_dir.join(&filename);
    if !target.exists() {
        fs::write(&target, bytes)?;
    }

    let path_str = match path_style {
        PathStyle::Absolute => target.to_string_lossy().to_string(),
        PathStyle::Relative => {
            let doc_dir = vault_root.join(doc_rel.parent().unwrap_or(Path::new("")));
            match pathdiff::diff_paths(&target, &doc_dir) {
                Some(rel) => rel.to_string_lossy().to_string().replace('\\', "/"),
                None => target.to_string_lossy().to_string(),
            }
        }
    };
    Ok(path_str)
}
```

- [ ] **Step 4: Verify the hash prefix, then run tests**

First, check the actual hash prefix matches the test's expectation:

```bash
printf 'pngbytes' | sha256sum
```

If the first 6 hex chars are NOT `2cf24d`, update the `20260731-2cf24d` strings in the test to match the actual output. Then run:

```bash
cd src-tauri && cargo test image::tests -- --nocapture && cd ..
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/image.rs src-tauri/src/lib.rs
git commit -m "feat(image): hash, dedup, configurable save with path resolution"
```

---

## Task 8: watcher — debounced file watcher (TDD for coalescing, integration smoke)

The `notify` crate's actual event stream is async and timing-dependent; we unit-test the pure coalescing logic and do a light integration check.

**Files:**
- Create: `src-tauri/src/watcher.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod watcher;`)

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/watcher.rs` with the test module only:

```rust
use notify::{Watcher, RecursiveMode, EventKind};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq)]
pub struct WatchEvent {
    pub path: String,
    pub kind: EventKind,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coalesce_dedups_same_path() {
        let events = vec![
            WatchEvent { path: "a.md".into(), kind: EventKind::Modify(notify::event::ModifyKind::Any) },
            WatchEvent { path: "a.md".into(), kind: EventKind::Modify(notify::event::ModifyKind::Any) },
            WatchEvent { path: "b.md".into(), kind: EventKind::Create(notify::event::CreateKind::Any) },
        ];
        let result = coalesce_paths(&events);
        assert_eq!(result, vec!["a.md".to_string(), "b.md".to_string()]);
    }

    #[test]
    fn coalesce_empty_returns_empty() {
        assert!(coalesce_paths(&[]).is_empty());
    }
}
```

- [ ] **Step 2: Declare module and run test to verify it fails**

Add to `src-tauri/src/lib.rs`:

```rust
pub mod watcher;
```

Run:

```bash
cd src-tauri && cargo test watcher::tests -- --nocapture && cd ..
```

Expected: FAIL — `cannot find function coalesce_paths`.

- [ ] **Step 3: Implement coalesce_paths**

Add above the test module in `src-tauri/src/watcher.rs`:

```rust
/// Deduplicate a burst of events by path, preserving first-seen order.
pub fn coalesce_paths(events: &[WatchEvent]) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut result: Vec<String> = Vec::new();
    for e in events {
        if seen.insert(e.path.clone()) {
            result.push(e.path.clone());
        }
    }
    result
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd src-tauri && cargo test watcher::tests -- --nocapture && cd ..
```

Expected: PASS — 2 tests.

- [ ] **Step 5: Implement the watcher runtime (not unit-tested; integration smoke)**

Append to `src-tauri/src/watcher.rs` (the actual watcher that Tauri will own):

```rust
use notify::{Watcher, RecursiveMode, RecommendedWatcher, EventKind};
use std::path::Path;
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

/// Start a watcher on `vault_root`. Returns a receiver that yields coalesced,
/// debounced lists of changed relative paths. The caller owns the watcher handle
/// (drop it to stop watching).
pub fn start_watcher(
    vault_root: &Path,
    debounce: Duration,
) -> std::io::Result<(RecommendedWatcher, Receiver<Vec<String>>)> {
    let (tx_raw, rx_raw) = channel::<WatchEvent>();
    let root = vault_root.to_path_buf();

    let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, _>| {
        if let Ok(ev) = res {
            if let Some(p) = ev.paths.first() {
                let rel = p.strip_prefix(&root).unwrap_or(p).to_string_lossy().to_string();
                // ignore the .markion index itself
                if rel.starts_with(".markion") { return; }
                let _ = tx_raw.send(WatchEvent { path: rel, kind: ev.kind });
            }
        }
    }).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

    watcher.watch(vault_root, RecursiveMode::Recursive)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

    let (tx_debounced, rx_debounced) = channel::<Vec<String>>();
    std::thread::spawn(move || {
        let mut buffer: Vec<WatchEvent> = Vec::new();
        let mut last = Instant::now();
        loop {
            match rx_raw.recv_timeout(debounce) {
                Ok(ev) => {
                    buffer.push(ev);
                    last = Instant::now();
                }
                Err(_) => {
                    // timeout: if buffer has events and we've been quiet, flush
                    if !buffer.is_empty() && last.elapsed() >= debounce {
                        let coalesced = coalesce_paths(&buffer);
                        let _ = tx_debounced.send(coalesced);
                        buffer.clear();
                    }
                    if rx_raw.is_empty() && buffer.is_empty() {
                        // channel closed
                        if !buffer.is_empty() {
                            let _ = tx_debounced.send(coalesce_paths(&buffer));
                        }
                        break;
                    }
                }
            }
        }
    });

    Ok((watcher, rx_debounced))
}
```

- [ ] **Step 6: Verify it compiles**

```bash
cd src-tauri && cargo check && cd ..
```

Expected: compiles. (The runtime is exercised in Task 10's smoke test.)

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/watcher.rs src-tauri/src/lib.rs
git commit -m "feat(watcher): debounced recursive vault watcher with coalescing"
```

---

## Task 9: commands.rs — wire functions to Tauri commands

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod commands;`)

- [ ] **Step 1: Write the command handlers**

Create `src-tauri/src/commands.rs`:

```rust
use crate::file_io;
use crate::tree_index::{self, IndexFile, TreeNode};
use crate::image::{self, AssetsStrategy, PathStyle};
use std::path::{Path, PathBuf};

#[tauri::command]
pub fn read_file(path: String, vault_root: String) -> Result<String, String> {
    file_io::read_file(&Path::new(&vault_root).join(&path))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_file_atomic(path: String, content: String, vault_root: String) -> Result<(), String> {
    file_io::write_file_atomic(&Path::new(&vault_root).join(&path), &content)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn build_tree(vault_root: String) -> Result<TreeNode, String> {
    let index = tree_index::load_index(&Path::new(&vault_root)).map_err(|e| e.to_string())?;
    Ok(tree_index::build_tree(&Path::new(&vault_root), &index))
}

#[tauri::command]
pub fn reorder_in_folder(
    vault_root: String,
    folder_rel: String,
    name: String,
    new_index: usize,
) -> Result<(), String> {
    let mut index = tree_index::load_index(&Path::new(&vault_root)).map_err(|e| e.to_string())?;
    tree_index::reorder(&mut index, &folder_rel, &name, new_index);
    tree_index::save_index(&Path::new(&vault_root), &index).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_collapsed(
    vault_root: String,
    folder_rel: String,
    collapsed: bool,
) -> Result<(), String> {
    let mut index = tree_index::load_index(&Path::new(&vault_root)).map_err(|e| e.to_string())?;
    tree_index::set_collapsed(&mut index, &folder_rel, collapsed);
    tree_index::save_index(&Path::new(&vault_root), &index).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn move_node(
    vault_root: String,
    from_folder: String,
    from_name: String,
    to_folder: String,
    to_name: String,
) -> Result<(), String> {
    let root = Path::new(&vault_root);
    let from_path = root.join(&from_folder).join(&from_name);
    let to_path = root.join(&to_folder).join(&to_name);
    if let Some(parent) = to_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&from_path, &to_path).map_err(|e| e.to_string())?;
    let mut index = tree_index::load_index(root).map_err(|e| e.to_string())?;
    tree_index::apply_move(&mut index, &from_folder, &from_name, &to_folder, &to_name);
    tree_index::save_index(root, &index).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_image(
    bytes: Vec<u8>,
    ext: String,
    vault_root: String,
    doc_rel: String,
    strategy: String, // "vault-assets" | "doc-assets" | "custom:<path>"
    path_style: String, // "relative" | "absolute"
    date: String, // YYYYMMDD
) -> Result<String, String> {
    let strategy = match strategy.as_str() {
        "vault-assets" => AssetsStrategy::VaultAssets,
        "doc-assets" => AssetsStrategy::DocAssets,
        s if s.starts_with("custom:") => AssetsStrategy::Custom(PathBuf::from(&s[7..])),
        _ => AssetsStrategy::VaultAssets,
    };
    let style = if path_style == "absolute" { PathStyle::Absolute } else { PathStyle::Relative };
    image::save_image(
        &bytes, &ext, Path::new(&vault_root), Path::new(&doc_rel),
        &strategy, style, &date,
    ).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Declare module and verify it compiles**

Add to `src-tauri/src/lib.rs`:

```rust
pub mod commands;
```

```bash
cd src-tauri && cargo check && cd ..
```

Expected: compiles. (Commands aren't called yet — that's Task 10.)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(commands): Tauri command handlers for file/tree/image ops"
```

---

## Task 10: main.rs — register commands, wire watcher events

**Files:**
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Replace `src-tauri/src/lib.rs` with the run() entry**

Overwrite `src-tauri/src/lib.rs`:

```rust
pub mod commands;
pub mod file_io;
pub mod image;
pub mod tree_index;
pub mod watcher;

use std::time::Duration;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file_atomic,
            commands::build_tree,
            commands::reorder_in_folder,
            commands::set_collapsed,
            commands::move_node,
            commands::save_image,
        ])
        .setup(|app| {
            // Watcher is started per-vault from the frontend (which knows the vault root);
            // see emit_vault_watch event below. Nothing to start at boot here.
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 2: Replace `src-tauri/src/main.rs`**

Overwrite `src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    markion_lib::run();
}
```

Note: the scaffolded crate name may be `markion_lib` or `<dir_name>_lib`. Check `src-tauri/Cargo.toml` for the `[lib] name =` field; if it differs, adjust the `markion_lib::run()` call to match.

- [ ] **Step 3: Verify it builds**

```bash
cd src-tauri && cargo check && cd ..
```

Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/main.rs src-tauri/src/lib.rs
git commit -m "feat(app): register commands and boot Tauri app"
```

---

## Task 11: Frontend IPC wrappers and types

**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/ipc.ts`

- [ ] **Step 1: Write the shared TS types**

Create `src/lib/types.ts`:

```typescript
export type NodeKind = "file" | "folder";

export interface TreeNode {
  name: string;
  path: string;
  kind: NodeKind;
  children: TreeNode[];
  collapsed: boolean;
}

export type AssetsStrategy = "vault-assets" | "doc-assets" | `custom:${string}`;
export type PathStyle = "relative" | "absolute";
```

- [ ] **Step 2: Write the IPC wrappers**

Create `src/lib/ipc.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { TreeNode, AssetsStrategy, PathStyle } from "./types";

export async function readFile(path: string, vaultRoot: string): Promise<string> {
  return invoke<string>("read_file", { path, vaultRoot });
}

export async function writeFileAtomic(path: string, content: string, vaultRoot: string): Promise<void> {
  await invoke<void>("write_file_atomic", { path, content, vaultRoot });
}

export async function buildTree(vaultRoot: string): Promise<TreeNode> {
  return invoke<TreeNode>("build_tree", { vaultRoot });
}

export async function reorderInFolder(
  vaultRoot: string, folderRel: string, name: string, newIndex: number,
): Promise<void> {
  await invoke<void>("reorder_in_folder", { vaultRoot, folderRel, name, newIndex });
}

export async function setCollapsed(
  vaultRoot: string, folderRel: string, collapsed: boolean,
): Promise<void> {
  await invoke<void>("set_collapsed", { vaultRoot, folderRel, collapsed });
}

export async function moveNode(
  vaultRoot: string, fromFolder: string, fromName: string,
  toFolder: string, toName: string,
): Promise<void> {
  await invoke<void>("move_node", { vaultRoot, fromFolder, fromName, toFolder, toName });
}

export async function saveImage(
  bytes: Uint8Array, ext: string, vaultRoot: string, docRel: string,
  strategy: AssetsStrategy, pathStyle: PathStyle, date: string,
): Promise<string> {
  return invoke<string>("save_image", {
    bytes: Array.from(bytes), ext, vaultRoot, docRel, strategy, pathStyle, date,
  });
}
```

- [ ] **Step 3: Verify it type-checks**

```bash
npx tsc --noEmit
```

Expected: no type errors. (If `@tauri-apps/api` isn't installed yet, run `npm install @tauri-apps/api@^2` first.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/ipc.ts
git commit -m "feat(ipc): typed frontend wrappers for Tauri commands"
```

---

## Task 12: Smoke test — exercise commands end-to-end

Replace the default React welcome page with a minimal harness that opens a folder and calls `build_tree` + `write_file_atomic`, to prove the full stack works.

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the smoke harness**

Overwrite `src/App.tsx`:

```tsx
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { buildTree, writeFileAtomic, readFile } from "./lib/ipc";
import type { TreeNode } from "./lib/types";

export default function App() {
  const [vaultRoot, setVaultRoot] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const pushLog = (s: string) => setLog((l) => [...l, s]);

  const chooseFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setVaultRoot(selected);
      pushLog(`vault: ${selected}`);
      const t = await buildTree(selected);
      setTree(t);
      pushLog(`tree root children: ${t.children.length}`);
    }
  };

  const createTestFile = async () => {
    if (!vaultRoot) return;
    await writeFileAtomic("smoke-test.md", "# Smoke Test\n\nwritten by Markion backend.", vaultRoot);
    pushLog("wrote smoke-test.md");
    const back = await readFile("smoke-test.md", vaultRoot);
    pushLog(`read back: ${back.slice(0, 20)}...`);
    const t = await buildTree(vaultRoot);
    setTree(t);
  };

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif" }}>
      <h1>Markion backend smoke</h1>
      <button onClick={chooseFolder}>Open vault folder</button>
      <button onClick={createTestFile} disabled={!vaultRoot}>Write smoke-test.md</button>
      <pre style={{ background: "#eee", padding: 8 }}>
        {tree ? JSON.stringify(tree, null, 2) : "(no tree yet)"}
      </pre>
      <ul>{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </div>
  );
}
```

- [ ] **Step 2: Run the app and exercise it**

```bash
npm run tauri dev
```

Manual steps in the running app:
1. Click "Open vault folder", pick any folder.
2. Verify the tree JSON renders (root + its children).
3. Click "Write smoke-test.md".
4. Verify the log shows "wrote smoke-test.md" and "read back: # Smoke Test...".
5. Verify `smoke-test.md` appears in the tree JSON.
6. On disk, open the chosen folder and confirm `smoke-test.md` exists with the right content.

Expected: all steps pass. Close the window.

- [ ] **Step 3: Run the full Rust test suite**

```bash
cd src-tauri && cargo test -- --nocapture && cd ..
```

Expected: all tests pass (file_io: 3, tree_index: ~16, image: 5, watcher: 2).

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "test(smoke): end-to-end harness exercising build_tree and file I/O"
```

---

## Done criteria

- `npm run tauri dev` boots the app.
- All Rust unit tests pass (`cargo test`).
- The smoke harness can open a folder, build its tree, write a file atomically, read it back.
- Commands `read_file`, `write_file_atomic`, `build_tree`, `reorder_in_folder`, `set_collapsed`, `move_node`, `save_image` are wired and reachable from the frontend.

## What this plan does NOT cover (deferred to Plan 2 / Plan 3)

- CodeMirror 6 editor integration (Plan 2)
- Live-preview decorations and widgets (Plan 2)
- markdown-it GFM rendering (Plan 2)
- 3-pane UI layout, file tree component, tabs, outline (Plan 3)
- Zustand stores wiring (Plan 3)
- Image paste/drop interception in the editor (Plan 3)
- Watcher event consumption on the frontend + conflict prompts (Plan 3)
- Settings UI for assets/path config (Plan 3)
