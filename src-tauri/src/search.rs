use serde::Serialize;
use std::path::Path;

/// One full-text match: which file, where, and a trimmed snippet for display.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SearchHit {
    pub path: String, // relative to vault root, forward slashes
    pub title: String, // filename without .md
    pub line: usize,  // 1-based line number
    pub column: usize, // 1-based character column of the match start
    pub snippet: String, // the matching line, trimmed and centered on the hit
}

/// Default cap on the number of hits returned per query.
pub const DEFAULT_MAX_HITS: usize = 500;

/// Full-text search over every `.md` file in the vault.
///
/// Matching is case-insensitive unless `case_sensitive` is set. Hidden
/// directories (`.markion`, `.git`, ...) are skipped so config and VCS files
/// never pollute results. Hits are sorted by path, then line, then column, and
/// truncated to `max_hits`.
pub fn search_vault(
    vault_root: &Path,
    query: &str,
    case_sensitive: bool,
    max_hits: usize,
) -> std::io::Result<Vec<SearchHit>> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let needle = if case_sensitive {
        query.to_string()
    } else {
        query.to_lowercase()
    };
    let max_hits = max_hits.max(1);

    let mut hits: Vec<SearchHit> = Vec::new();
    walk(vault_root, vault_root, &needle, case_sensitive, &mut hits)?;
    hits.sort_by(|a, b| {
        a.path
            .cmp(&b.path)
            .then(a.line.cmp(&b.line))
            .then(a.column.cmp(&b.column))
    });
    hits.truncate(max_hits);
    Ok(hits)
}

const SNIPPET_LEN: usize = 140;

fn walk(
    root: &Path,
    dir: &Path,
    needle: &str,
    case_sensitive: bool,
    out: &mut Vec<SearchHit>,
) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();
        if name.starts_with('.') {
            continue; // hidden dirs (.markion, .git, ...) and hidden files
        }
        if path.is_dir() {
            walk(root, &path, needle, case_sensitive, out)?;
        } else if path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase() == "md")
            .unwrap_or(false)
        {
            let text = std::fs::read_to_string(&path)?;
            scan_text(root, &path, &text, needle, case_sensitive, out);
        }
    }
    Ok(())
}

fn scan_text(
    root: &Path,
    path: &Path,
    text: &str,
    needle: &str,
    case_sensitive: bool,
    out: &mut Vec<SearchHit>,
) {
    // Lowercase only ASCII queries: `to_lowercase` can change the byte length
    // of some Unicode code points (e.g. İ -> i + combining dot), which would
    // desync match offsets from the raw text. CJK and other scripts don't have
    // case anyway, so exact matching is the correct behaviour there.
    let hay: std::borrow::Cow<str> = if !case_sensitive && needle.is_ascii() {
        std::borrow::Cow::Owned(text.to_lowercase())
    } else {
        std::borrow::Cow::Borrowed(text)
    };
    let rel = path
        .strip_prefix(root)
        .map(|p| p.to_string_lossy().to_string().replace('\\', "/"))
        .unwrap_or_default();
    let title = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    // line / line_start track the current line as we walk matches left to
    // right. Advance only when the match lies strictly after the current
    // line's newline, so a match at the very start of a line (or mid-line)
    // never skips its own line.
    let mut line = 1usize;
    let mut line_start = 0usize;
    for (idx, _) in hay.match_indices(needle) {
        loop {
            let Some(off) = text[line_start..].find('\n') else { break };
            let next_start = line_start + off + 1;
            if next_start > idx {
                break;
            }
            line_start = next_start;
            line += 1;
        }
        let line_end = text[line_start..]
            .find('\n')
            .map(|off| line_start + off)
            .unwrap_or(text.len());
        let raw_line = &text[line_start..line_end];
        // Column in characters (1-based), so CJK text reports a human column.
        let column = raw_line[..idx.saturating_sub(line_start)]
            .chars()
            .count()
            + 1;
        out.push(SearchHit {
            path: rel.clone(),
            title: title.clone(),
            line,
            column,
            snippet: make_snippet(raw_line, idx.saturating_sub(line_start), SNIPPET_LEN),
        });
    }
}

/// Trim a line and center it on the match offset, capping the length and
/// marking elided edges with '…'. Always keeps `match_start` inside the result.
fn make_snippet(line: &str, match_start: usize, max_len: usize) -> String {
    let trimmed = line.trim();
    let lead = line.len() - line.trim_start().len(); // bytes trimmed on the left
    let rel = match_start.saturating_sub(lead);
    if trimmed.len() <= max_len {
        return trimmed.to_string();
    }
    let mut lo = rel.saturating_sub(max_len / 3);
    // Clamp so the window fits within the trimmed line.
    if lo + max_len > trimmed.len() {
        lo = trimmed.len().saturating_sub(max_len);
    }
    while lo > 0 && !trimmed.is_char_boundary(lo) {
        lo -= 1;
    }
    let mut hi = (lo + max_len).min(trimmed.len());
    while hi < trimmed.len() && !trimmed.is_char_boundary(hi) {
        hi += 1;
    }
    let mut out = String::new();
    if lo > 0 {
        out.push('…');
    }
    out.push_str(&trimmed[lo..hi]);
    if hi < trimmed.len() {
        out.push('…');
    }
    out
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
    fn finds_case_insensitive_matches_across_files() {
        let dir = tempdir().unwrap();
        write_vault(
            dir.path(),
            &[
                ("a.md", "Alpha note about tauri.\nMore text."),
                ("notes/b.md", "tauri is great."),
                ("c.md", "nothing here"),
            ],
        );
        let hits = search_vault(dir.path(), "Tauri", false, 100).unwrap();
        assert_eq!(hits.len(), 2);
        assert!(hits.iter().all(|h| h.snippet.to_lowercase().contains("tauri")));
        let paths: Vec<&String> = hits.iter().map(|h| &h.path).collect();
        assert!(paths.contains(&&"a.md".to_string()));
        assert!(paths.contains(&&"notes/b.md".to_string()));
        // Sorted by path.
        assert_eq!(hits[0].path, "a.md");
        assert_eq!(hits[1].path, "notes/b.md");
    }

    #[test]
    fn reports_line_and_column_and_snippet() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "line one\nneedle here\nline three")]);
        let hits = search_vault(dir.path(), "needle", false, 100).unwrap();
        assert_eq!(hits.len(), 1);
        let h = &hits[0];
        assert_eq!(h.line, 2);
        assert_eq!(h.column, 1);
        assert_eq!(h.snippet, "needle here");
        assert_eq!(h.title, "a");
    }

    #[test]
    fn multiple_hits_on_one_line() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "x needle y needle z")]);
        let hits = search_vault(dir.path(), "needle", false, 100).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].column, 3);
        assert_eq!(hits[1].column, 12);
    }

    #[test]
    fn case_sensitive_mode() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "Tauri tauri TAURI")]);
        let hits = search_vault(dir.path(), "tauri", true, 100).unwrap();
        assert_eq!(hits.len(), 1); // only the lowercase occurrence
        assert_eq!(hits[0].column, 7);
    }

    #[test]
    fn skips_hidden_directories_and_non_md_files() {
        let dir = tempdir().unwrap();
        write_vault(
            dir.path(),
            &[
                (".markion/config.json", "{\"secret\":\"tauri\"}"),
                (".git/hooks/x.md", "tauri should not appear"),
                ("docs.md", "tauri in the docs"),
                ("readme.txt", "tauri not md"),
            ],
        );
        let hits = search_vault(dir.path(), "tauri", false, 100).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "docs.md");
    }

    #[test]
    fn caps_total_hits() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "hit\nhit\nhit\nhit\nhit")]);
        let hits = search_vault(dir.path(), "hit", false, 3).unwrap();
        assert_eq!(hits.len(), 3);
    }

    #[test]
    fn empty_query_returns_nothing() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "content")]);
        let hits = search_vault(dir.path(), "   ", false, 100).unwrap();
        assert!(hits.is_empty());
    }

    #[test]
    fn long_line_snippet_is_centered_and_capped() {
        let dir = tempdir().unwrap();
        let long_line = format!("{}needle{}", "x".repeat(200), "y".repeat(200));
        write_vault(dir.path(), &[("a.md", &long_line)]);
        let hits = search_vault(dir.path(), "needle", false, 100).unwrap();
        assert_eq!(hits.len(), 1);
        let s = &hits[0].snippet;
        // `…` is one char, so the cap is SNIPPET_LEN + two ellipsis chars.
        assert!(s.chars().count() <= SNIPPET_LEN + 2, "snippet too long: {}", s.len());
        assert!(s.contains("needle"), "match must stay visible: {s}");
    }

    #[test]
    fn non_ascii_query_matches_exactly() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "设计文档\n关于设计 的笔记")]);
        let hits = search_vault(dir.path(), "设计", false, 100).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].line, 1);
        assert_eq!(hits[1].line, 2);
        assert_eq!(hits[1].column, 3); // 关于设计: 设计 starts at the 3rd char
        assert!(hits.iter().all(|h| h.snippet.contains("设计")));
    }
}
