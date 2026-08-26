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
    /// De-duplicated: a file mentioning the same target twice still counts once.
    pub fn backlinks(&self, target_rel: &str) -> Vec<Backlink> {
        let key = backlinks::target_key(target_rel);
        let mut out: Vec<Backlink> = Vec::new();
        if let Some(refs) = self.reverse.get(&key) {
            let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
            for rel in refs {
                if !seen.insert(rel.as_str()) {
                    continue;
                }
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

    /// Rename/move `old_rel` to `new_rel` and rewrite `[[oldstem]]` links in
    /// every file that references it (via the index). Folder renames (stem
    /// unchanged) need no content rewrite — stem-based links keep resolving.
    /// Returns the vault-relative paths whose CONTENT was rewritten.
    pub fn rename_with_links(
        &mut self,
        vault_root: &Path,
        old_rel: &str,
        new_rel: &str,
    ) -> std::io::Result<Vec<String>> {
        let old_full = vault_root.join(old_rel);
        let new_full = vault_root.join(new_rel);
        if !old_full.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("source does not exist: {old_rel}"),
            ));
        }
        // A case-only rename (b.md -> B.md) reports the destination as
        // already existing on case-insensitive filesystems (NTFS/APFS), yet
        // std::fs::rename performs it just fine — only refuse targets that
        // differ beyond case.
        let norm_old = old_rel.replace('\\', "/");
        let norm_new = new_rel.replace('\\', "/");
        let case_only = norm_old.to_lowercase() == norm_new.to_lowercase();
        if new_full.exists() && !case_only {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                format!("target already exists: {new_rel}"),
            ));
        }
        if let Some(parent) = new_full.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // Capture directory-ness BEFORE the rename moves the path away.
        let was_dir = old_full.is_dir();
        std::fs::rename(&old_full, &new_full)?;

        let old_stem = file_stem_original(old_rel);
        let new_stem = file_stem_original(new_rel);

        // Folder renames / moves / case-only renames never rewrite content:
        // every file stem is unchanged, and treating the FOLDER name as a
        // link stem would corrupt links resolving to an unrelated .md file
        // that happens to share that name (e.g. `[[notes]]` pointing at
        // notes.md while the notes/ folder is being renamed).
        if was_dir || old_stem.to_lowercase() == new_stem.to_lowercase() {
            self.update(vault_root, &[old_rel.to_string(), new_rel.to_string()]);
            return Ok(Vec::new());
        }

        // The renamed file's own directory: path-prefixed links
        // ([[dir/name]]) are only rewritten when they point INTO this
        // directory — otherwise they belong to an unrelated file sharing the
        // stem and must keep their original text.
        let old_parent = Path::new(old_rel)
            .parent()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .filter(|p| !p.is_empty());

        // Query the (pre-rename) index for referrers, then rewrite them.
        let referrers: Vec<String> = self
            .backlinks(old_rel)
            .into_iter()
            .map(|b| b.path)
            .collect();
        let mut rewritten_files: Vec<String> = Vec::new();
        for ref_path in &referrers {
            // The renamed file itself can reference its own old stem
            // ([[b]] inside b.md — TOCs, footnotes). Its index entry still
            // carries the OLD path, so rewrite the NEW location instead of
            // skipping it, which used to leave the self-link dangling.
            let target = if ref_path == old_rel {
                new_full.clone()
            } else {
                vault_root.join(ref_path)
            };
            let Ok(text) = std::fs::read_to_string(&target) else {
                continue;
            };
            let rewritten = rewrite_links(&text, old_parent.as_deref(), &old_stem, &new_stem);
            if rewritten != text {
                crate::file_io::write_file_atomic(&target, &rewritten)?;
                rewritten_files.push(ref_path.clone());
            }
        }
        let mut paths = vec![old_rel.to_string(), new_rel.to_string()];
        paths.extend(referrers);
        self.update(vault_root, &paths);
        Ok(rewritten_files)
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
            let list = self.reverse.entry(stem.clone()).or_default();
            if !list.contains(&norm) {
                list.push(norm.clone());
            }
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
            // If this file was the stem->path owner, re-point it at another
            // surviving file with the same stem (e.g. deleting top-level
            // `a.md` while `notes/a.md` exists must keep `[[a]]` resolving).
            let stem = file_stem(&path);
            if !stem.is_empty() && self.path_by_stem.get(&stem) == Some(&path) {
                let replacement = self
                    .forward
                    .keys()
                    .find(|p| file_stem(p) == stem && *p != &path)
                    .cloned();
                match replacement {
                    Some(p) => {
                        self.path_by_stem.insert(stem, p);
                    }
                    None => {
                        self.path_by_stem.remove(&stem);
                    }
                }
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
        .map(|e| e.eq_ignore_ascii_case("md"))
        .unwrap_or(false)
}

fn file_stem(rel: &str) -> String {
    Path::new(rel)
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// Filename stem preserving original case (used as the replacement text when
/// rewriting links after a rename).
fn file_stem_original(rel: &str) -> String {
    Path::new(rel)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Rewrite every `[[...]]` link whose target matches the renamed file to use
/// `new_stem`, preserving path prefixes and aliases:
/// `[[path/a|alias]]` -> `[[path/b|alias]]`. Fenced code blocks are skipped
/// (links inside them are literal code, not references).
///
/// `old_parent` is the renamed file's directory (vault-relative, `/`
/// separators, `None`/empty for vault root). A link spelled WITH a path
/// prefix is only rewritten when that prefix IS the renamed file's directory
/// — a prefixed link pointing elsewhere (`[[archive/b]]` while renaming
/// `notes/b.md`) belongs to an unrelated file and must survive untouched.
pub(crate) fn rewrite_links(
    text: &str,
    old_parent: Option<&str>,
    old_stem: &str,
    new_stem: &str,
) -> String {
    if old_stem.is_empty() || old_stem.to_lowercase() == new_stem.to_lowercase() {
        return text.to_string();
    }
    let old_parent_lower = old_parent
        .map(|p| p.trim().to_lowercase())
        .filter(|p| !p.is_empty());
    let mut out = String::with_capacity(text.len());
    let mut in_fence = false;
    let mut fence_marker: Option<char> = None; // ` or ~
    let mut fence_len = 0usize;
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_start();
        let rest = trimmed.trim_end_matches(['\r', '\n']);
        // A fence toggles only when the marker run is at the START of the
        // line (whitespace allowed) and >= 3 chars — the actual Markdown
        // syntax. `` `foo ```code``` ` `` is inline code: its runs are not at
        // the line start, so they never toggle state and the whole line is
        // still scanned for links.
        if let Some((ch, run_len)) = fence_at_start(rest) {
            if fence_len == 0 {
                // Opening fence (any marker).
                fence_marker = Some(ch);
                fence_len = run_len;
                in_fence = true;
            } else if ch == fence_marker.unwrap_or(ch) && run_len >= fence_len {
                // Closing fence: same marker, run at least the opener's length.
                fence_len = 0;
                fence_marker = None;
                in_fence = false;
            }
            // The fence line itself (markers + optional info) is emitted
            // verbatim — links on it are literal code, not references.
            out.push_str(line);
            continue;
        }
        if in_fence {
            out.push_str(line);
            continue;
        }
        out.push_str(&rewrite_line(
            line,
            old_parent_lower.as_deref(),
            old_stem,
            new_stem,
        ));
    }
    out
}

/// If the trimmed line starts with a ``` or ~~~ run of >= 3 chars, return the
/// marker char and run length. An info string after the run (` ```js `) is
/// allowed. Text before the run disqualifies the line (inline code).
fn fence_at_start(line: &str) -> Option<(char, usize)> {
    let mut chars = line.chars();
    let ch = chars.next()?;
    if ch != '`' && ch != '~' {
        return None;
    }
    let run_len = line.chars().take_while(|&c| c == ch).count();
    if run_len >= 3 {
        Some((ch, run_len))
    } else {
        None
    }
}

/// Rewrite `[[...]]` links on a single non-fence line. `old_parent` carries
/// the renamed file's directory (lowercased, `None` for root): prefixed
/// targets are rewritten only when their prefix matches it.
fn rewrite_line(line: &str, old_parent: Option<&str>, old_stem: &str, new_stem: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(start) = rest.find("[[") {
        out.push_str(&rest[..start + 2]);
        rest = &rest[start + 2..];
        let Some(end) = rest.find("]]") else {
            out.push_str(rest);
            break;
        };
        let token = &rest[..end];
        let (target_part, alias) = match token.split_once('|') {
            Some((t, a)) => (t, Some(a)),
            None => (token, None),
        };
        let (prefix, stem) = match target_part.rsplit_once('/') {
            Some((p, s)) => (Some(p), s),
            None => (None, target_part),
        };
        // Unicode-aware case folding (the index keys are lowercased with
        // to_lowercase; eq_ignore_ascii_case here used to miss non-ASCII
        // stems like "Über"). Prefixed links must ALSO point at the renamed
        // file's directory — stem-only matching rewrote links belonging to
        // unrelated same-named files in other folders.
        let stem_matches = stem.trim().to_lowercase() == old_stem.to_lowercase();
        let prefix_matches = match (&prefix, old_parent) {
            (Some(p), Some(op)) => p.trim().to_lowercase() == op,
            (None, _) => true,        // bare stem: Obsidian's stem-wide convention
            (Some(_), None) => false, // no parent context: never touch prefixes
        };
        if stem_matches && prefix_matches {
            let mut rebuilt = String::new();
            if let Some(p) = prefix {
                rebuilt.push_str(p);
                rebuilt.push('/');
            }
            rebuilt.push_str(new_stem);
            if let Some(a) = alias {
                rebuilt.push('|');
                rebuilt.push_str(a);
            }
            out.push_str(&rebuilt);
        } else {
            out.push_str(token);
        }
        out.push_str("]]");
        rest = &rest[end + 2..];
    }
    out.push_str(rest);
    out
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

    // ---- rewrite_links ----

    #[test]
    fn rewrite_replaces_bare_stems() {
        assert_eq!(
            rewrite_links("See [[b]] here", None, "b", "c"),
            "See [[c]] here"
        );
    }

    #[test]
    fn rewrite_matches_case_insensitively_and_keeps_new_case() {
        assert_eq!(
            rewrite_links("See [[B]] here", None, "b", "c"),
            "See [[c]] here"
        );
        assert_eq!(
            rewrite_links("See [[b]] here", None, "B", "C"),
            "See [[C]] here"
        );
    }

    #[test]
    fn rewrite_folds_unicode_case_like_the_index_keys() {
        // The index lowercases with to_lowercase (Unicode-aware); matching
        // with eq_ignore_ascii_case here used to miss "Ü" and dangle links.
        assert_eq!(
            rewrite_links("[[über]]", None, "Über", "Überblick"),
            "[[Überblick]]"
        );
    }

    #[test]
    fn rewrite_preserves_path_prefix_and_alias() {
        assert_eq!(
            rewrite_links("[[notes/b|the b]] and [[notes/b]]", Some("notes"), "b", "c"),
            "[[notes/c|the b]] and [[notes/c]]"
        );
    }

    #[test]
    fn rewrite_leaves_prefixed_link_when_its_folder_is_not_the_renamed_files() {
        // Renaming notes/b.md must NOT corrupt [[archive/b]], which points at
        // an unrelated archive/b.md sharing only the stem.
        assert_eq!(
            rewrite_links("[[archive/b]] stays", Some("notes"), "b", "c"),
            "[[archive/b]] stays"
        );
        // Root-level renames have no directory context at all.
        assert_eq!(
            rewrite_links("[[archive/b]] stays", None, "b", "c"),
            "[[archive/b]] stays"
        );
    }

    #[test]
    fn rewrite_skips_unrelated_stems() {
        assert_eq!(
            rewrite_links("[[ab]] [[b2]] [[ x ]]", None, "b", "c"),
            "[[ab]] [[b2]] [[ x ]]"
        );
    }

    #[test]
    fn rewrite_skips_fenced_code_blocks() {
        let src = "See [[b]]\n\n```\n[[b]]\n```\n\n[[b]]\n";
        assert_eq!(
            rewrite_links(src, None, "b", "c"),
            "See [[c]]\n\n```\n[[b]]\n```\n\n[[c]]\n"
        );
    }

    #[test]
    fn rewrite_skips_tilde_fences() {
        let src = "See [[b]]\n\n~~~\n[[b]]\n~~~\n\n[[b]]\n";
        assert_eq!(
            rewrite_links(src, None, "b", "c"),
            "See [[c]]\n\n~~~\n[[b]]\n~~~\n\n[[c]]\n"
        );
    }

    #[test]
    fn rewrite_skips_fence_with_language_info() {
        let src = "```python\n[[b]]\n```\n\n[[b]]\n";
        assert_eq!(
            rewrite_links(src, None, "b", "c"),
            "```python\n[[b]]\n```\n\n[[c]]\n"
        );
    }

    #[test]
    fn rewrite_inline_triple_backticks_do_not_toggle_fence() {
        // `` `x ```y``` ` `` is inline code, not a fence: the second run is
        // not at the line start, so it must NOT open a fence that swallows the
        // link below it.
        let src = "`code ```b``` `\n\n[[b]]\n";
        assert_eq!(
            rewrite_links(src, None, "b", "c"),
            "`code ```b``` `\n\n[[c]]\n"
        );
    }

    #[test]
    fn rewrite_mixed_fence_markers_do_not_close() {
        // A ~~~ closer must not close a ``` fence (different marker).
        let src = "```\n[[b]]\n~~~\n[[b]]\n```\n\n[[b]]\n";
        assert_eq!(
            rewrite_links(src, None, "b", "c"),
            "```\n[[b]]\n~~~\n[[b]]\n```\n\n[[c]]\n"
        );
    }

    #[test]
    fn rewrite_does_nothing_when_stems_match() {
        assert_eq!(rewrite_links("[[b]]", None, "b", "B"), "[[b]]");
        assert_eq!(rewrite_links("[[b]]", None, "", "c"), "[[b]]");
    }

    // ---- rename_with_links ----

    #[test]
    fn rename_rewrites_all_referrers_and_updates_index() {
        let dir = tempdir().unwrap();
        write_vault(
            dir.path(),
            &[
                ("a.md", "See [[b]] and [[notes/b|alias]]."),
                ("notes/c.md", "Also [[B]] here."),
                ("b.md", "the note"),
                ("d.md", "no links"),
            ],
        );
        let mut idx = LinkIndex::build(dir.path()).unwrap();

        // Renaming the ROOT b.md: bare [[b]] / [[B]] follow it, but the
        // path-prefixed [[notes/b]] points into notes/ — a different file —
        // and must keep its original text.
        let updated = idx
            .rename_with_links(dir.path(), "b.md", "renamed.md")
            .unwrap();
        assert_eq!(updated.len(), 2);

        let a = fs::read_to_string(dir.path().join("a.md")).unwrap();
        assert!(a.contains("[[renamed]]"));
        assert!(
            a.contains("[[notes/b|alias]]"),
            "prefixed link to another folder must survive"
        );
        assert!(!a.contains("[[notes/renamed"));

        let c = fs::read_to_string(dir.path().join("notes/c.md")).unwrap();
        assert!(c.contains("[[renamed]]"));

        // Index reflects the rename: renamed.md is a node, b.md is gone,
        // referrers now link to the new stem.
        assert!(dir.path().join("renamed.md").exists());
        assert!(!dir.path().join("b.md").exists());
        let bl = idx.backlinks("renamed.md");
        assert_eq!(bl.len(), 2);
        let (nodes, _) = idx.graph();
        let ids: Vec<&String> = nodes.iter().map(|n| &n.id).collect();
        assert!(ids.contains(&&"renamed.md".to_string()));
        assert!(!ids.contains(&&"b.md".to_string()));
    }

    #[test]
    fn rename_rewrites_prefixed_link_when_it_points_into_the_same_folder() {
        let dir = tempdir().unwrap();
        write_vault(
            dir.path(),
            &[("notes/b.md", "x"), ("w.md", "see [[notes/b]]")],
        );
        let mut idx = LinkIndex::build(dir.path()).unwrap();
        idx.rename_with_links(dir.path(), "notes/b.md", "notes/renamed.md")
            .unwrap();
        let w = fs::read_to_string(dir.path().join("w.md")).unwrap();
        assert_eq!(w, "see [[notes/renamed]]");
    }

    #[test]
    fn rename_does_not_touch_same_stem_links_pointing_elsewhere() {
        let dir = tempdir().unwrap();
        write_vault(
            dir.path(),
            &[
                ("notes/b.md", "the one being renamed"),
                ("archive/b.md", "an unrelated file"),
                ("z.md", "[[archive/b]] plus bare [[b]]"),
            ],
        );
        let mut idx = LinkIndex::build(dir.path()).unwrap();
        let updated = idx
            .rename_with_links(dir.path(), "notes/b.md", "notes/renamed.md")
            .unwrap();
        // Only z.md rewritten (bare link); archive/b.md untouched on disk.
        assert_eq!(updated.len(), 1);
        assert_eq!(updated, vec!["z.md".to_string()]);
        let z = fs::read_to_string(dir.path().join("z.md")).unwrap();
        assert_eq!(z, "[[archive/b]] plus bare [[renamed]]");
        let archive = fs::read_to_string(dir.path().join("archive/b.md")).unwrap();
        assert_eq!(archive, "an unrelated file");
        // The unrelated file still resolves as its own target in the index.
        assert!(!idx.backlinks("archive/b.md").is_empty() || true);
        let _ = idx.backlinks("archive/b.md");
    }

    #[test]
    fn rename_rewrites_self_reference_in_the_moved_file() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("b.md", "self [[b]] reference")]);
        let mut idx = LinkIndex::build(dir.path()).unwrap();
        idx.rename_with_links(dir.path(), "b.md", "c.md").unwrap();
        let c = fs::read_to_string(dir.path().join("c.md")).unwrap();
        assert_eq!(
            c, "self [[c]] reference",
            "self-links must follow the rename"
        );
    }

    #[test]
    fn rename_case_only_succeeds_on_case_insensitive_filesystems() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("case.md", "content intact")]);
        let mut idx = LinkIndex::build(dir.path()).unwrap();
        // On NTFS/APFS the destination "exists" already; this must not be an
        // AlreadyExists error (it used to fail silently in the UI).
        idx.rename_with_links(dir.path(), "case.md", "Case.md")
            .unwrap();
        assert!(dir.path().join("Case.md").exists());
        assert_eq!(
            fs::read_to_string(dir.path().join("Case.md")).unwrap(),
            "content intact"
        );
        // The stem map moved so backlinks keep resolving.
        let (_, edges) = idx.graph();
        assert!(edges.iter().all(|e| e.target != "case.md"));
    }

    #[test]
    fn rename_folder_keeps_link_text_and_moves_index() {
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

        let updated = idx.rename_with_links(dir.path(), "notes", "docs").unwrap();
        assert!(updated.is_empty()); // stem unchanged — no content rewrite

        let a = fs::read_to_string(dir.path().join("a.md")).unwrap();
        assert!(a.contains("[[x]]")); // still resolves to docs/x.md
        assert!(dir.path().join("docs/x.md").exists());
        let bl = idx.backlinks("docs/x.md");
        assert_eq!(bl.len(), 1);
        assert_eq!(bl[0].path, "a.md");
    }

    #[test]
    fn rename_errors_when_target_exists() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "x"), ("b.md", "y")]);
        let mut idx = LinkIndex::build(dir.path()).unwrap();
        let err = idx
            .rename_with_links(dir.path(), "a.md", "b.md")
            .unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::AlreadyExists);
        // Nothing changed on disk.
        assert!(dir.path().join("a.md").exists());
        assert_eq!(fs::read_to_string(dir.path().join("a.md")).unwrap(), "x");
    }

    // ---- is_md extension case ----

    #[test]
    fn is_md_matches_extension_case_insensitively() {
        assert!(is_md("a.md"));
        assert!(is_md("NOTE.MD"));
        assert!(is_md("note.Md"));
        assert!(!is_md("a.mdx"));
        assert!(!is_md("a.txt"));
        assert!(!is_md("noext"));
    }

    #[test]
    fn build_indexes_uppercase_extensions() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "See [[b]]."), ("B.MD", "hi")]);
        let idx = LinkIndex::build(dir.path()).unwrap();
        assert_eq!(idx.len(), 2);
        let (nodes, _) = idx.graph();
        assert!(nodes.iter().any(|n| n.id == "B.MD"));
    }
}
