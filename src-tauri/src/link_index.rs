use crate::backlinks::{self, Backlink, GraphEdge, GraphNode};
use std::collections::HashMap;
use std::path::Path;

/// Incremental link index for the current vault.
///
/// `find_backlinks` / `scan_graph` used to re-scan every `.md` file in the
/// vault on each call (O(vault size) per query). This index is built once and
/// then kept in sync from the watcher's change events, so queries are
/// O(affected files) instead of O(vault size).
///
/// Invariants:
/// - `forward[rel]` lists the `[[...]]` target stems found in that file.
/// - `reverse[stem]` lists the files that link to that stem.
/// - `path_by_stem[stem]` maps a stem to the first file with that name
///   (Obsidian's "nearest wins" convention; matches `backlinks.rs`).
#[derive(Debug, Default)]
pub struct LinkIndex {
    pub vault_root: std::path::PathBuf,
    forward: HashMap<String, Vec<String>>,
    reverse: HashMap<String, Vec<String>>,
    path_by_stem: HashMap<String, String>,
}

impl LinkIndex {
    /// Empty index for `vault_root` (used when a full build fails; queries
    /// then fall back to on-demand full scans).
    pub fn empty(vault_root: std::path::PathBuf) -> Self {
        Self {
            vault_root,
            ..Default::default()
        }
    }

    /// Full build: walk the vault and index every `.md` file.
    pub fn build(vault_root: &Path) -> std::io::Result<Self> {
        let mut idx = Self::empty(vault_root.to_path_buf());
        let mut files: Vec<String> = Vec::new();
        collect_md_files(vault_root, vault_root, &mut files)?;
        for rel in files {
            idx.upsert_file(vault_root, &rel);
        }
        Ok(idx)
    }

    /// Apply a batch of watcher events (relative paths). Files that no longer
    /// exist are removed; directories are recursively indexed. Unknown
    /// non-md paths are dropped.
    pub fn update(&mut self, vault_root: &Path, paths: &[String]) {
        for rel in paths {
            let norm = rel.replace('\\', "/");
            let full = vault_root.join(&norm);
            if full.is_dir() {
                // A directory changed (created/removed/renamed): index all
                // .md files under it (idempotent) and prune entries that no
                // longer exist.
                let mut files: Vec<String> = Vec::new();
                if let Ok(()) = collect_md_files(vault_root, &full, &mut files) {
                    for f in files {
                        self.upsert_file(vault_root, &f);
                    }
                }
                self.prune_missing(vault_root, Some(&norm));
            } else if full.exists() {
                if is_md(&norm) {
                    self.upsert_file(vault_root, &norm);
                } else {
                    // A non-md file changed: it can't contribute links, but a
                    // rename may have removed an indexed md path.
                    self.remove_file(&norm);
                }
            } else {
                self.remove_file(&norm);
            }
        }
        // Defensive: events may miss deletions (e.g. whole-tree removes).
        self.prune_missing(vault_root, None);
    }

    /// Files linking to `target_rel` (matched by stem, case-insensitive).
    pub fn backlinks(&self, target_rel: &str) -> Vec<Backlink> {
        let key = backlinks::target_key(target_rel);
        let mut out: Vec<Backlink> = Vec::new();
        if let Some(refs) = self.reverse.get(&key) {
            for rel in refs {
                let title = Path::new(rel)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                out.push(Backlink {
                    path: rel.clone(),
                    title,
                });
            }
        }
        out.sort_by(|a, b| a.path.cmp(&b.path));
        out
    }

    /// All indexed files as nodes, plus one edge per link that resolves to an
    /// indexed file (by stem). Sorted for deterministic output.
    pub fn graph(&self) -> (Vec<GraphNode>, Vec<GraphEdge>) {
        let mut nodes: Vec<GraphNode> = self
            .forward
            .keys()
            .map(|rel| GraphNode {
                id: rel.clone(),
                title: Path::new(rel)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default(),
            })
            .collect();
        nodes.sort_by(|a, b| a.id.cmp(&b.id));

        let mut edges: Vec<GraphEdge> = Vec::new();
        let mut seen: std::collections::HashSet<(String, String)> =
            std::collections::HashSet::new();
        for (source, stems) in &self.forward {
            for stem in stems {
                if let Some(target) = self.path_by_stem.get(stem) {
                    let key = (source.clone(), target.clone());
                    if seen.insert(key.clone()) {
                        edges.push(GraphEdge {
                            source: source.clone(),
                            target: target.clone(),
                        });
                    }
                }
            }
        }
        edges.sort_by(|a, b| {
            (a.source.clone(), a.target.clone()).cmp(&(b.source.clone(), b.target.clone()))
        });
        (nodes, edges)
    }

    /// Number of indexed files.
    pub fn len(&self) -> usize {
        self.forward.len()
    }

    /// True when nothing is indexed yet.
    pub fn is_empty(&self) -> bool {
        self.forward.is_empty()
    }

    // ---- internals ----

    /// (Re)parse `rel` and sync it into all three maps.
    fn upsert_file(&mut self, vault_root: &Path, rel: &str) {
        let norm = rel.replace('\\', "/");
        let old_stems = self.forward.remove(&norm).unwrap_or_default();
        // Drop the old reverse entries for this file.
        for stem in &old_stems {
            if let Some(list) = self.reverse.get_mut(stem) {
                list.retain(|p| p != &norm);
                if list.is_empty() {
                    self.reverse.remove(stem);
                }
            }
        }
        // Re-read the file and parse fresh link stems.
        let full = vault_root.join(&norm);
        let text = match std::fs::read_to_string(&full) {
            Ok(t) => t,
            Err(_) => {
                // Unreadable — treat as removed.
                self.remove_file(&norm);
                return;
            }
        };
        let stems = backlinks::link_targets(&text);
        self.forward.insert(norm.clone(), stems.clone());
        for stem in stems {
            self.reverse
                .entry(stem.clone())
                .or_default()
                .push(norm.clone());
        }
        // Stem -> path mapping: first occurrence wins (keeps existing mapping
        // unless it pointed at this file already).
        let stem = file_stem(&norm);
        if !stem.is_empty() {
            self.path_by_stem
                .entry(stem.clone())
                .or_insert_with(|| norm.clone());
        }
        // If the file was the previous owner of its own stem (e.g. renamed),
        // make sure the mapping still points at an existing file.
        if let Some(current) = self.path_by_stem.get(&stem) {
            if current == &norm || !vault_root.join(current).exists() {
                self.path_by_stem.insert(stem, norm.clone());
            }
        }
    }

    /// Remove `rel` (and any indexed descendants) from all maps.
    fn remove_file(&mut self, rel: &str) {
        let norm = rel.replace('\\', "/");
        let affected: Vec<String> = self
            .forward
            .keys()
            .filter(|p| *p == &norm || p.starts_with(&format!("{norm}/")))
            .cloned()
            .collect();
        for path in affected {
            if let Some(stems) = self.forward.remove(&path) {
                for stem in stems {
                    if let Some(list) = self.reverse.get_mut(&stem) {
                        list.retain(|p| p != &path);
                        if list.is_empty() {
                            self.reverse.remove(&stem);
                        }
                    }
                }
            }
            if self.path_by_stem.get(&file_stem(&path)) == Some(&path) {
                self.path_by_stem.remove(&file_stem(&path));
            }
        }
    }

    /// Drop entries whose files no longer exist on disk (optionally only under
    /// `prefix`). Keeps the index consistent when events were missed.
    fn prune_missing(&mut self, vault_root: &Path, prefix: Option<&str>) {
        let stale: Vec<String> = self
            .forward
            .keys()
            .filter(|p| {
                prefix.is_none_or(|pfx| p.starts_with(&format!("{pfx}/")) || *p == pfx)
                    && !vault_root.join(p).exists()
            })
            .cloned()
            .collect();
        for path in stale {
            self.remove_file(&path);
        }
    }
}

fn is_md(rel: &str) -> bool {
    Path::new(rel)
        .extension()
        .map(|e| e == "md")
        .unwrap_or(false)
}

fn file_stem(rel: &str) -> String {
    Path::new(rel)
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn collect_md_files(root: &Path, dir: &Path, out: &mut Vec<String>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_md_files(root, &path, out)?;
        } else if is_md(&path.to_string_lossy()) {
            let rel = path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().to_string().replace('\\', "/"))
                .unwrap_or_default();
            out.push(rel);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
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
    fn build_indexes_all_files_and_links() {
        let dir = tempdir().unwrap();
        write_vault(
            dir.path(),
            &[
                ("a.md", "See [[b]] and [[notes/c]]."),
                ("b.md", "No links."),
                ("notes/c.md", "Back to [[a]]."),
            ],
        );
        let idx = LinkIndex::build(dir.path()).unwrap();
        assert_eq!(idx.len(), 3);
        let (nodes, edges) = idx.graph();
        assert_eq!(nodes.len(), 3);
        let has_edge = |s: &str, t: &str| edges.iter().any(|e| e.source == s && e.target == t);
        assert!(has_edge("a.md", "b.md"));
        assert!(has_edge("a.md", "notes/c.md"));
        assert!(has_edge("notes/c.md", "a.md"));
    }

    #[test]
    fn backlinks_match_legacy_full_scan() {
        let dir = tempdir().unwrap();
        write_vault(
            dir.path(),
            &[
                ("a.md", "See [[notes/design]] and more."),
                ("b.md", "No links here."),
                ("notes/design.md", "The design doc."),
                ("notes/other.md", "Mentions [[design]] too."),
            ],
        );
        let idx = LinkIndex::build(dir.path()).unwrap();
        let from_index = idx.backlinks("notes/design.md");
        let from_scan = backlinks::find_backlinks(dir.path(), "notes/design.md").unwrap();
        assert_eq!(from_index, from_scan);
        let paths: Vec<&String> = from_index.iter().map(|b| &b.path).collect();
        assert!(paths.contains(&&"a.md".to_string()));
        assert!(paths.contains(&&"notes/other.md".to_string()));
        assert!(!paths.contains(&&"b.md".to_string()));
    }

    #[test]
    fn update_adds_new_file() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "plain text")]);
        let mut idx = LinkIndex::build(dir.path()).unwrap();
        assert!(idx.backlinks("b.md").is_empty());
        assert!(idx.backlinks("a.md").is_empty());

        fs::write(dir.path().join("b.md"), "See [[a]].").unwrap();
        idx.update(dir.path(), &["b.md".to_string()]);
        let bl = idx.backlinks("a.md");
        assert_eq!(bl.len(), 1);
        assert_eq!(bl[0].path, "b.md");
    }

    #[test]
    fn update_reflects_link_changes() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "See [[b]]."), ("c.md", "plain")]);
        let mut idx = LinkIndex::build(dir.path()).unwrap();
        assert_eq!(idx.backlinks("b.md").len(), 1);

        // a.md stops linking to b
        fs::write(dir.path().join("a.md"), "No links now.").unwrap();
        idx.update(dir.path(), &["a.md".to_string()]);
        assert!(idx.backlinks("b.md").is_empty());

        // a.md now links to c
        fs::write(dir.path().join("a.md"), "See [[c]].").unwrap();
        idx.update(dir.path(), &["a.md".to_string()]);
        let bl = idx.backlinks("c.md");
        assert_eq!(bl.len(), 1);
        assert_eq!(bl[0].path, "a.md");
    }

    #[test]
    fn update_removes_deleted_file() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "See [[b]]."), ("b.md", "hi")]);
        let mut idx = LinkIndex::build(dir.path()).unwrap();
        assert_eq!(idx.backlinks("b.md").len(), 1);
        assert_eq!(idx.len(), 2);

        fs::remove_file(dir.path().join("a.md")).unwrap();
        idx.update(dir.path(), &["a.md".to_string()]);
        assert!(idx.backlinks("b.md").is_empty());
        assert_eq!(idx.len(), 1);
        let (nodes, _) = idx.graph();
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].id, "b.md");
    }

    #[test]
    fn update_removes_whole_directory() {
        let dir = tempdir().unwrap();
        write_vault(
            dir.path(),
            &[
                ("a.md", "See [[x]]."),
                ("notes/x.md", "hi"),
                ("notes/y.md", "hey"),
            ],
        );
        let mut idx = LinkIndex::build(dir.path()).unwrap();
        assert_eq!(idx.len(), 3);

        // Directory deletion often reports just the directory path.
        fs::remove_dir_all(dir.path().join("notes")).unwrap();
        idx.update(dir.path(), &["notes".to_string()]);
        assert_eq!(idx.len(), 1);
        let (nodes, _) = idx.graph();
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].id, "a.md");
        // The referring file still mentions [[x]] — like the legacy full scan,
        // the (now unresolved) link keeps a.md listed as a reference.
        let bl = idx.backlinks("x.md");
        assert_eq!(bl.len(), 1);
        assert_eq!(bl[0].path, "a.md");
    }

    #[test]
    fn update_handles_rename() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "See [[b]]."), ("b.md", "hi")]);
        let mut idx = LinkIndex::build(dir.path()).unwrap();

        // b.md -> c.md
        fs::rename(dir.path().join("b.md"), dir.path().join("c.md")).unwrap();
        idx.update(dir.path(), &["b.md".to_string(), "c.md".to_string()]);
        // a.md still says [[b]] (unresolved now) — legacy behavior keeps it
        // as a reference; the renamed file itself is no longer indexed.
        let bl_b = idx.backlinks("b.md");
        assert_eq!(bl_b.len(), 1);
        assert_eq!(bl_b[0].path, "a.md");
        assert!(idx.backlinks("c.md").is_empty());
        let (nodes, _) = idx.graph();
        let ids: Vec<&String> = nodes.iter().map(|n| &n.id).collect();
        assert!(ids.contains(&&"c.md".to_string()));
        assert!(!ids.contains(&&"b.md".to_string()));
    }

    #[test]
    fn stem_map_keeps_first_occurrence() {
        let dir = tempdir().unwrap();
        write_vault(
            dir.path(),
            &[
                ("a.md", "See [[design]]."),
                ("sub/design.md", "the design"),
                ("design.md", "top-level"),
            ],
        );
        let idx = LinkIndex::build(dir.path()).unwrap();
        // The stem maps to whichever file was indexed first (read_dir order is
        // not guaranteed), but exactly one of the two design files wins and
        // the edge resolves to it.
        let (_, edges) = idx.graph();
        let targets: Vec<&String> = edges
            .iter()
            .filter(|e| e.source == "a.md")
            .map(|e| &e.target)
            .collect();
        assert_eq!(targets.len(), 1);
        assert!(targets[0] == "sub/design.md" || targets[0] == "design.md");
    }
}
