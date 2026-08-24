use serde::Serialize;
use std::path::Path;

/// One tag occurrence: which tag, in which file.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TagEntry {
    /// Tag name without the leading `#`.
    pub tag: String,
    /// Relative path with forward slashes.
    pub path: String,
    /// Filename without `.md`.
    pub title: String,
}

/// Scan every `.md` file in the vault and collect the tags declared in each
/// note's frontmatter (`tags:` property, comma separated). Yuque-style: tags
/// are document METADATA — inline `#fragment` text in the body is never a
/// tag. Hidden directories (`.markion`, `.obsidian`, ...) are skipped.
pub fn scan_tags(vault_root: &Path) -> std::io::Result<Vec<TagEntry>> {
    let mut entries: Vec<TagEntry> = Vec::new();
    walk(vault_root, vault_root, &mut entries)?;
    entries.sort_by(|a, b| a.tag.cmp(&b.tag).then(a.path.cmp(&b.path)));
    Ok(entries)
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<TagEntry>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue; // hidden dirs and files
        }
        if path.is_dir() {
            walk(root, &path, out)?;
        } else if path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase() == "md")
            .unwrap_or(false)
        {
            let text = std::fs::read_to_string(&path)?;
            let rel = path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().to_string().replace('\\', "/"))
                .unwrap_or_default();
            let title = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            // Deduplicate tags within a single file.
            let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
            for tag in extract_tags(&text) {
                if seen.insert(tag.clone()) {
                    out.push(TagEntry {
                        tag,
                        path: rel.clone(),
                        title: title.clone(),
                    });
                }
            }
        }
    }
    Ok(())
}

/// Tags of one note = the frontmatter `tags:` values. Purely numeric values
/// ("2024") are rejected — they are dates/numbers, not tags.
pub fn extract_tags(text: &str) -> Vec<String> {
    crate::docdb::extract_frontmatter(text)
        .map(|fm| fm.props)
        .unwrap_or_default()
        .iter()
        .filter(|(k, _)| k == "tags")
        .flat_map(|(_, v)| v.split(','))
        .map(|t| t.trim().trim_start_matches('#').to_string())
        .filter(|t| !t.is_empty() && !t.chars().all(|c| c.is_numeric()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn reads_frontmatter_tags_only() {
        let text = "---\ntags: todo, plan\n---\n#todo #设计 [[link]]\n";
        assert_eq!(extract_tags(text), vec!["todo", "plan"]);
    }

    #[test]
    fn body_hashes_are_never_tags() {
        // Headings, years, serial numbers, CSDN-style anchors in the BODY
        // must not leak into the tag list.
        let text = "---\ntitle: x\n---\n# 2024\n#1 #365project #real-tag\n";
        assert!(extract_tags(text).is_empty());
    }

    #[test]
    fn numeric_and_empty_values_rejected() {
        let text = "---\ntags: 2024, , ok1, #tagged\n---\nb";
        assert_eq!(extract_tags(text), vec!["ok1", "tagged"]);
    }

    #[test]
    fn no_frontmatter_no_tags() {
        assert!(extract_tags("#just heading\n#tag-ish text").is_empty());
    }

    #[test]
    fn scan_gathers_files_and_skips_hidden() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join(".markion")).unwrap();
        fs::create_dir_all(dir.path().join("notes")).unwrap();
        fs::write(dir.path().join("a.md"), "---\ntags: todo\n---\nbody").unwrap();
        fs::write(
            dir.path().join("notes/b.md"),
            "---\ntags: todo, idea\n---\nbody",
        )
        .unwrap();
        fs::write(dir.path().join(".markion/x.md"), "---\ntags: hidden\n---\n").unwrap();
        let entries = scan_tags(dir.path()).unwrap();
        assert_eq!(entries.len(), 3); // todo(a), todo(b), idea(b)
        assert_eq!(entries[0].tag, "idea");
        assert_eq!(entries[0].path, "notes/b.md");
        assert!(entries.iter().all(|e| e.path != ".markion/x.md"));
    }
}
