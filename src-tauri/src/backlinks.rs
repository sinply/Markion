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
}
