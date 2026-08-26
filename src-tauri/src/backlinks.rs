use serde::Serialize;
use std::path::Path;

/// A backlink: a `.md` file that references the target doc via `[[...]]`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Backlink {
    pub path: String, // relative to vault root
    pub title: String,
}

/// The bare target name used for matching: the doc's filename without `.md`.
pub(crate) fn target_key(doc_rel: &str) -> String {
    let name = Path::new(doc_rel)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    name.to_lowercase()
}

/// Find `.md` files in `vault_root` whose `[[...]]` links reference `target`.
/// Matching is by filename-stem (case-insensitive), the Obsidian convention.
/// Supports `[[name]]`, `[[path/name]]`, `[[name|alias]]`, and anchored
/// targets (`[[name#section]]`, `[[note#^blockid]]`). Hidden dot-entries
/// (`.markion/trash/...`) are skipped, and unreadable files never abort the
/// scan.
pub fn find_backlinks(vault_root: &Path, target: &str) -> std::io::Result<Vec<Backlink>> {
    let key = target_key(target);
    if key.is_empty() {
        return Ok(vec![]);
    }
    let mut result: Vec<Backlink> = Vec::new();
    walk(vault_root, vault_root, &key, &mut result)?;
    result.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(result)
}

/// Does `text` contain a `[[...]]` link whose target stem equals `key`?
/// Handles `[[name]]`, `[[path/name]]`, `[[name|alias]]`, and anchors
/// (`[[name#section]]`, `[[note#^blockid]]`); the stem match is
/// exact-after-slash so `[[mydesign]]` doesn't match key "design".
/// Markdown-aware: links inside fenced code blocks or inline-code spans are
/// literal code and never count (via [`crate::wikilink`]).
fn links_to(text: &str, key: &str) -> bool {
    crate::wikilink::extract_wikilink_targets(text)
        .iter()
        .any(|stem| stem == key)
}

fn walk(root: &Path, dir: &Path, key: &str, out: &mut Vec<Backlink>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue; // hidden files and dirs (.markion/trash/..., .obsidian/...)
        }
        let path = entry.path();
        if path.is_dir() {
            walk(root, &path, key, out)?;
        } else if path
            .extension()
            .map(|e| e.eq_ignore_ascii_case("md"))
            .unwrap_or(false)
        {
            // One unreadable/non-UTF8 file must not abort the whole walk.
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            if links_to(&text, key) {
                let rel = path
                    .strip_prefix(root)
                    .map(|p| p.to_string_lossy().to_string().replace('\\', "/"))
                    .unwrap_or_default();
                let title = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                out.push(Backlink { path: rel, title });
            }
        }
    }
    Ok(())
}

/// A node in the vault graph.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GraphNode {
    pub id: String, // relative path, forward slashes
    pub title: String,
}

/// A directed edge: `source` links to `target` (by filename stem).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}

/// Extract all `[[...]]` target stems from `text` (lowercased, alias and
/// `#`-anchors stripped, order preserved, no dedup). Markdown-aware: fenced
/// code blocks and inline-code spans never yield targets. This feeds the
/// primary `LinkIndex` (`link_index.rs`), so it must agree with
/// [`crate::wikilink::extract_wikilink_targets`].
pub(crate) fn link_targets(text: &str) -> Vec<String> {
    crate::wikilink::extract_wikilink_targets(text)
}

/// Scan the whole vault: return every `.md` file as a node, plus one edge for
/// each `[[...]]` link that resolves to an existing file (by stem).
pub fn scan_graph(vault_root: &Path) -> std::io::Result<(Vec<GraphNode>, Vec<GraphEdge>)> {
    let mut nodes: Vec<GraphNode> = Vec::new();
    let mut stem_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    // First pass: collect all md files and map stem -> rel path.
    collect_files(vault_root, vault_root, &mut nodes, &mut stem_map)?;

    // Second pass: read each file's [[...]] links, build edges that resolve.
    let mut edges: Vec<GraphEdge> = Vec::new();
    let mut seen: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
    for node in &nodes {
        // One unreadable/non-UTF8 file must not abort the whole scan.
        let Ok(text) = std::fs::read_to_string(vault_root.join(&node.id)) else {
            continue;
        };
        for target_stem in link_targets(&text) {
            if let Some(target_path) = stem_map.get(&target_stem) {
                let key = (node.id.clone(), target_path.clone());
                if seen.insert(key.clone()) {
                    edges.push(GraphEdge {
                        source: node.id.clone(),
                        target: target_path.clone(),
                    });
                }
            }
        }
    }
    Ok((nodes, edges))
}

fn collect_files(
    root: &Path,
    dir: &Path,
    nodes: &mut Vec<GraphNode>,
    stem_map: &mut std::collections::HashMap<String, String>,
) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue; // hidden files and dirs (.markion/trash/..., .obsidian/...)
        }
        let path = entry.path();
        if path.is_dir() {
            collect_files(root, &path, nodes, stem_map)?;
        } else if path
            .extension()
            .map(|e| e.eq_ignore_ascii_case("md"))
            .unwrap_or(false)
        {
            let rel = path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().to_string().replace('\\', "/"))
                .unwrap_or_default();
            let stem = Path::new(&rel)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string().to_lowercase())
                .unwrap_or_default();
            let title = Path::new(&rel)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            stem_map.entry(stem).or_insert_with(|| rel.clone());
            nodes.push(GraphNode { id: rel, title });
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
    fn finds_files_linking_to_target() {
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
        let backlinks = find_backlinks(dir.path(), "notes/design.md").unwrap();
        let paths: Vec<&String> = backlinks.iter().map(|b| &b.path).collect();
        assert!(paths.contains(&&"a.md".to_string()));
        assert!(paths.contains(&&"notes/other.md".to_string()));
        assert!(!paths.contains(&&"b.md".to_string()));
    }

    #[test]
    fn empty_when_no_links() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "just text")]);
        let backlinks = find_backlinks(dir.path(), "a.md").unwrap();
        assert!(backlinks.is_empty());
    }

    #[test]
    fn links_to_matches_forms() {
        assert!(links_to("See [[design]] here", "design"));
        assert!(links_to("See [[notes/design]] here", "design"));
        assert!(links_to("See [[design|alias]] here", "design"));
        assert!(!links_to("See [[mydesign]] here", "design"));
        assert!(!links_to("plain text", "design"));
        assert!(links_to("[[A]] and [[B]]", "b"));
    }

    #[test]
    fn link_targets_extracts_stems() {
        assert_eq!(
            link_targets("See [[design]] and [[notes/api]]"),
            vec!["design", "api"]
        );
        assert_eq!(link_targets("[[a|alias]] here"), vec!["a"]);
        assert_eq!(link_targets("no links"), Vec::<String>::new());
    }

    #[test]
    fn scan_graph_builds_nodes_and_edges() {
        let dir = tempdir().unwrap();
        write_vault(
            dir.path(),
            &[
                ("a.md", "See [[b]] and [[notes/c]]."),
                ("b.md", "No links."),
                ("notes/c.md", "Back to [[a]]."),
            ],
        );
        let (nodes, edges) = scan_graph(dir.path()).unwrap();
        assert_eq!(nodes.len(), 3);
        let has_edge = |s: &str, t: &str| edges.iter().any(|e| e.source == s && e.target == t);
        assert!(has_edge("a.md", "b.md"));
        assert!(has_edge("a.md", "notes/c.md"));
        assert!(has_edge("notes/c.md", "a.md"));
    }

    // ---- batch 3: anchors, code spans, unreadable files, hidden dirs, case ----

    #[test]
    fn anchor_and_blockref_links_resolve_to_stem() {
        assert_eq!(link_targets("[[design#Intro]]"), vec!["design"]);
        assert_eq!(link_targets("[[note#^abc123]]"), vec!["note"]);
        assert_eq!(
            link_targets("[[notes/design#Section Two|Alias]]"),
            vec!["design"]
        );
        assert!(links_to("[[design#Intro]]", "design"));
        assert!(links_to("[[note#^abc]]", "note"));
    }

    #[test]
    fn anchor_links_produce_backlinks_and_graph_edges() {
        let dir = tempdir().unwrap();
        write_vault(
            dir.path(),
            &[
                ("a.md", "See [[design#Intro]] for context."),
                ("b.md", "Block ref: [[design#^abc]]."),
                ("design.md", "The design doc."),
            ],
        );
        let backlinks = find_backlinks(dir.path(), "design.md").unwrap();
        let paths: Vec<&String> = backlinks.iter().map(|bl| &bl.path).collect();
        assert!(paths.contains(&&"a.md".to_string()));
        assert!(paths.contains(&&"b.md".to_string()));

        let (_, edges) = scan_graph(dir.path()).unwrap();
        assert!(edges
            .iter()
            .any(|e| e.source == "a.md" && e.target == "design.md"));
        assert!(edges
            .iter()
            .any(|e| e.source == "b.md" && e.target == "design.md"));
    }

    #[test]
    fn fenced_code_blocks_do_not_count_as_links() {
        assert!(link_targets("before\n```\n[[x]]\n```\nafter").is_empty());
        assert!(link_targets("~~~\n[[x]]\n~~~").is_empty());
        assert!(link_targets("```js\n[[x]]\n```\n").is_empty());
        // A ~~~ line must not close a ``` fence.
        assert!(link_targets("```\n[[x]]\n~~~\n[[x]]\n```").is_empty());
        assert!(!links_to("```\n[[x]]\n```", "x"));
        // Inline triple backticks are inline code, not a fence opener.
        assert_eq!(link_targets("`c ```x``` `\n\n[[real]]"), vec!["real"]);
        // Links outside the fence still count.
        assert_eq!(
            link_targets("[[a]]\n```\n[[x]]\n```\n[[b]]"),
            vec!["a", "b"]
        );
    }

    #[test]
    fn inline_code_spans_are_not_links() {
        assert!(link_targets("see `[[x]]` here").is_empty());
        assert!(!links_to("see `[[x]]` here", "x"));
        // Pairwise spans; real links around them survive.
        assert_eq!(
            link_targets("[[pre]] `[[x]]` mid ``p`` [[post]]"),
            vec!["pre", "post"]
        );
        // A longer run inside a short span does not close it.
        assert!(link_targets("`a ```b [[x]] c`").is_empty());
    }

    #[test]
    fn unreadable_files_are_skipped_not_fatal() {
        let dir = tempdir().unwrap();
        write_vault(
            dir.path(),
            &[("good.md", "Links [[design]]."), ("design.md", "target")],
        );
        // Invalid UTF-8 bytes: read_to_string fails for this file only.
        fs::write(dir.path().join("bad.md"), [0xff, 0xfe, 0x00, 0xd8]).unwrap();

        let backlinks = find_backlinks(dir.path(), "design.md").unwrap();
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].path, "good.md");

        // The unreadable file still EXISTS on disk, so it may appear as a
        // graph node — but its content contributes no links/edges and, most
        // importantly, neither scan aborts.
        let (nodes, edges) = scan_graph(dir.path()).unwrap();
        assert!(nodes.iter().any(|n| n.id == "good.md"));
        assert!(!edges.iter().any(|e| e.source == "bad.md"));
        assert!(edges
            .iter()
            .any(|e| e.source == "good.md" && e.target == "design.md"));
    }

    #[test]
    fn trash_and_dot_entries_are_never_indexed() {
        let dir = tempdir().unwrap();
        write_vault(
            dir.path(),
            &[
                ("design.md", "the target"),
                (".markion/trash/x.md", "Links [[design]] from trash."),
                (".hidden/y.md", "[[design]]"),
            ],
        );
        let backlinks = find_backlinks(dir.path(), "design.md").unwrap();
        assert!(backlinks.iter().all(|b| !b.path.starts_with('.')));
        let (nodes, _) = scan_graph(dir.path()).unwrap();
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].id, "design.md");
    }

    #[test]
    fn uppercase_md_extension_is_indexed() {
        let dir = tempdir().unwrap();
        write_vault(
            dir.path(),
            &[("NOTE.MD", "Links [[design]]."), ("design.md", "t")],
        );
        let backlinks = find_backlinks(dir.path(), "design.md").unwrap();
        let paths: Vec<&String> = backlinks.iter().map(|b| &b.path).collect();
        assert!(paths.contains(&&"NOTE.MD".to_string()));
        let (nodes, edges) = scan_graph(dir.path()).unwrap();
        assert_eq!(nodes.len(), 2);
        assert!(nodes.iter().any(|n| n.id == "NOTE.MD"));
        assert!(edges
            .iter()
            .any(|e| e.source == "NOTE.MD" && e.target == "design.md"));
    }
}
