use serde::Serialize;
use std::path::Path;

/// A backlink: a `.md` file that references the target doc via `[[...]]`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Backlink {
    pub path: String, // relative to vault root
    pub title: String,
}

/// The bare target name used for matching: the doc's filename without `.md`.
fn target_key(doc_rel: &str) -> String {
    let name = Path::new(doc_rel)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    name.to_lowercase()
}

/// Find `.md` files in `vault_root` whose `[[...]]` links reference `target`.
/// Matching is by filename-stem (case-insensitive), the Obsidian convention.
/// Supports both `[[name]]` and `[[path/name]]` (and `[[name|alias]]`) forms.
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
/// Handles `[[name]]`, `[[path/name]]`, and `[[name|alias]]`; the stem match
/// is exact-after-slash so `[[mydesign]]` doesn't match key "design".
fn links_to(text: &str, key: &str) -> bool {
    let lower = text.to_lowercase();
    let mut rest = lower.as_str();
    while let Some(start) = rest.find("[[") {
        rest = &rest[start + 2..];
        let Some(end) = rest.find("]]") else {
            break;
        };
        let token = &rest[..end];
        rest = &rest[end + 2..];
        // strip alias `|...`
        let target_part = token.split('|').next().unwrap_or(token);
        // take the stem after the last '/'
        let stem = target_part.rsplit('/').next().unwrap_or(target_part);
        if stem.trim() == key {
            return true;
        }
    }
    false
}

fn walk(
    root: &Path,
    dir: &Path,
    key: &str,
    out: &mut Vec<Backlink>,
) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            walk(root, &path, key, out)?;
        } else if path.extension().map(|e| e == "md").unwrap_or(false) {
            let text = std::fs::read_to_string(&path)?;
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

/// Extract all `[[...]]` target stems from `text` (lowercased, alias stripped).
fn link_targets(text: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    let mut out = Vec::new();
    let mut rest = lower.as_str();
    while let Some(start) = rest.find("[[") {
        rest = &rest[start + 2..];
        let Some(end) = rest.find("]]") else { break };
        let token = &rest[..end];
        rest = &rest[end + 2..];
        let target_part = token.split('|').next().unwrap_or(token).trim();
        let stem = target_part.rsplit('/').next().unwrap_or(target_part);
        if !stem.is_empty() {
            out.push(stem.to_string());
        }
    }
    out
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
        let text = std::fs::read_to_string(vault_root.join(&node.id))?;
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
        let path = entry.path();
        if path.is_dir() {
            collect_files(root, &path, nodes, stem_map)?;
        } else if path.extension().map(|e| e == "md").unwrap_or(false) {
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
        assert_eq!(link_targets("See [[design]] and [[notes/api]]"), vec!["design", "api"]);
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
}
