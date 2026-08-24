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

/// Scan every `.md` file in the vault and extract `#tag` occurrences.
/// Hidden directories (`.markion`, `.git`, ...) are skipped. Tags inside
/// fenced code blocks, inline code, and `[[...]]` wiki links are excluded.
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
            // Deduplicate tags within a single file (a tag used 5 times is
            // still one entry).
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

/// Obsidian-style tag character: word chars, `_`, `-`, `/` (nested tags),
/// and CJK. A tag cannot end with `/`.
fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-' || c == '/'
}

/// A tag's FIRST character: letters, CJK, or `_` — never a digit. This is the
/// Obsidian rule and it keeps years/serial numbers (`#2024`, `#1`, `#365`) out
/// of the tag list.
fn starts_tag(c: char) -> bool {
    (c.is_alphabetic() || c == '_')
}

/// Extract unique-in-order `#tag` names from markdown text, skipping fenced
/// code blocks, inline code spans, and wiki-link targets.
pub fn extract_tags(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut tags: Vec<String> = Vec::new();
    let mut in_fence = false;
    let mut fence_marker = ""; // "```" or "~~~"
    let mut i = 0usize;

    while i < chars.len() {
        if chars[i] == '\n' {
            i += 1;
            continue;
        }
        // Line-oriented fence detection (``` or ~~~ at line start).
        let line_end = chars[i..]
            .iter()
            .position(|&c| c == '\n')
            .map(|off| i + off)
            .unwrap_or(chars.len());
        let line: String = chars[i..line_end].iter().collect();
        let trimmed = line.trim_start();
        let is_fence_open = trimmed.starts_with("```") || trimmed.starts_with("~~~");
        if is_fence_open {
            if !in_fence {
                in_fence = true;
                fence_marker = if trimmed.starts_with("```") {
                    "```"
                } else {
                    "~~~"
                };
            } else if trimmed.starts_with(fence_marker) {
                in_fence = false;
            }
            i = line_end + 1;
            continue;
        }
        if in_fence {
            i = line_end + 1;
            continue;
        }

        // Inline scan: skip `code` spans and [[wiki links]].
        let mut in_code = false;
        while i < line_end {
            let c = chars[i];
            if c == '`' {
                in_code = !in_code;
                i += 1;
                continue;
            }
            if in_code {
                i += 1;
                continue;
            }
            // Wiki link: consume until the closing ]].
            if c == '[' && i + 1 < line_end && chars[i + 1] == '[' {
                i += 2;
                while i < line_end && !(chars[i] == ']' && i + 1 < line_end && chars[i + 1] == ']')
                {
                    i += 1;
                }
                i = (i + 2).min(line_end);
                continue;
            }
            if c == '#' && i + 1 < line_end && starts_tag(chars[i + 1]) {
                // Collect the tag body. `# Title` (heading) never matches
                // because a space follows `#`.
                let start = i + 1;
                let mut end = start;
                while end < line_end && is_tag_char(chars[end]) {
                    end += 1;
                }
                // A trailing '/' means an incomplete nested tag (`#a/`) —
                // drop it entirely rather than trimming to `#a`. A purely
                // numeric body can no longer occur (first char is checked),
                // but guard anyway against odd unicode numerics.
                let body: String = chars[start..end].iter().collect();
                let all_digits = !body.is_empty() && body.chars().all(|c| c.is_numeric());
                if !body.is_empty() && !body.ends_with('/') && !all_digits {
                    tags.push(body);
                }
                i = end;
                continue;
            }
            i += 1;
        }
        i = line_end + 1;
    }
    tags
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn extracts_basic_and_cjk_tags() {
        let tags = extract_tags("see #todo and #设计 and #a/b nested\n");
        assert_eq!(tags, vec!["todo", "设计", "a/b"]);
    }

    #[test]
    fn headings_are_not_tags() {
        let tags = extract_tags("# Title\n## Sub\n");
        assert!(tags.is_empty());
    }

    #[test]
    fn skips_fenced_code_and_inline_code() {
        let text = "```rust\n// #code_tag\nlet x = 1;\n```\nuse `#inline_tag` here\n";
        let tags = extract_tags(text);
        assert!(tags.is_empty());
    }

    #[test]
    fn skips_wikilink_heading_fragments() {
        let tags = extract_tags("see [[note#section]] and [[other]]\n");
        assert!(tags.is_empty());
    }

    #[test]
    fn drops_incomplete_nested_tag_and_keeps_duplicates() {
        // extract_tags reports every occurrence; dedup happens per-file in scan.
        let tags = extract_tags("#same #same #a/ #b\n");
        assert_eq!(tags, vec!["same", "same", "b"]);
    }

    #[test]
    fn numeric_tags_are_rejected() {
        // Years, serial numbers, issue refs — never tags.
        let tags = extract_tags("#2024 #1 #365project v2 #a1\n");
        assert_eq!(tags, vec!["a1"]);
    }

    #[test]
    fn scan_gathers_files_and_skips_hidden() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join(".markion")).unwrap();
        fs::create_dir_all(dir.path().join("notes")).unwrap();
        fs::write(dir.path().join("a.md"), "#todo one\n").unwrap();
        fs::write(dir.path().join("notes/b.md"), "#todo and #idea\n").unwrap();
        fs::write(dir.path().join(".markion/x.md"), "#hidden\n").unwrap();
        let entries = scan_tags(dir.path()).unwrap();
        assert_eq!(entries.len(), 3); // todo(a.md), todo(notes/b.md), idea(notes/b.md)
        assert_eq!(entries[0].tag, "idea");
        assert_eq!(entries[0].path, "notes/b.md");
        assert!(entries.iter().all(|e| e.path != ".markion/x.md"));
    }
}
