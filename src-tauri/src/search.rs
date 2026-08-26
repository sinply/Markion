use regex::RegexBuilder;
use serde::Serialize;
use std::path::Path;

/// One full-text match: which file, where, and a trimmed snippet for display.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SearchHit {
    pub path: String,    // relative to vault root, forward slashes
    pub title: String,   // filename without .md
    pub line: usize,     // 1-based line number
    pub column: usize,   // 1-based character column of the match start
    pub snippet: String, // the matching line, trimmed and centered on the hit
}

/// Default cap on the number of hits returned per query.
pub const DEFAULT_MAX_HITS: usize = 500;

/// Full-text search over every `.md` file in the vault.
///
/// Matching is case-insensitive unless `case_sensitive` is set. When
/// `use_regex` is set, `query` is compiled as a regular expression (invalid
/// patterns produce an `InvalidInput` error). Hidden directories (`.markion`,
/// `.git`, ...) are skipped so config and VCS files never pollute results.
/// Hits are sorted by path, then line, then column, and truncated to
/// `max_hits`.
pub fn search_vault(
    vault_root: &Path,
    query: &str,
    case_sensitive: bool,
    use_regex: bool,
    max_hits: usize,
) -> std::io::Result<Vec<SearchHit>> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let max_hits = max_hits.max(1);

    let mut hits: Vec<SearchHit> = Vec::new();
    walk(
        vault_root,
        vault_root,
        &query,
        case_sensitive,
        use_regex,
        &mut hits,
    )?;
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
    query: &str,
    case_sensitive: bool,
    use_regex: bool,
    out: &mut Vec<SearchHit>,
) -> std::io::Result<()> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        // An unreadable directory is skipped — one locked folder must not
        // make the whole vault search return an error with zero results.
        Err(_) => return Ok(()),
    };
    for entry in entries {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();
        if name.starts_with('.') {
            continue; // hidden dirs (.markion, .git, ...) and hidden files
        }
        if path.is_dir() {
            walk(root, &path, query, case_sensitive, use_regex, out)?;
        } else if path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase() == "md")
            .unwrap_or(false)
        {
            // Non-UTF8/unreadable files are skipped, not fatal.
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            scan_text(root, &path, &text, query, case_sensitive, use_regex, out)?;
        }
    }
    Ok(())
}

/// Collect `(start, end)` byte offsets of every match of `query` in `text`.
fn match_offsets(
    text: &str,
    query: &str,
    case_sensitive: bool,
    use_regex: bool,
) -> std::io::Result<Vec<(usize, usize)>> {
    if use_regex {
        let re = RegexBuilder::new(query)
            .case_insensitive(!case_sensitive)
            .multi_line(true) // `^`/`$` anchor per line, like per-line search
            .build()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e.to_string()))?;
        Ok(re.find_iter(text).map(|m| (m.start(), m.end())).collect())
    } else if case_sensitive || !query.is_ascii() {
        // Lowercasing can change byte lengths for some Unicode code points
        // (e.g. İ -> i + combining dot), which would desync offsets from the
        // raw text; CJK and other scripts don't have case anyway, so exact
        // matching is correct there.
        Ok(text
            .match_indices(query)
            .map(|(i, m)| (i, i + m.len()))
            .collect())
    } else {
        // Case-insensitive literal match. Lowercasing can change BYTE lengths
        // for some code points (e.g. U+212A KELVIN SIGN → k, or İ → i + dot),
        // so offsets computed on the lowercased haystack may not be char
        // boundaries in the raw text — slicing raw_line[..idx] would panic.
        // Lowercase per CHAR instead, which preserves 1:1 char boundaries.
        // Build a char-indexed copy of the text, tracking each char's byte
        // offset, then match the lowercased needle against it. Slicing the
        // RAW text at the stored byte offsets is always a char boundary, so
        // code points whose lowercase form changes byte length (U+212A K → k,
        // İ → i+dot) can never desync the offsets and panic scan_text.
        let hay: Vec<char> = text.chars().collect();
        let byte_at: Vec<usize> = {
            let mut v = Vec::with_capacity(hay.len() + 1);
            let mut b = 0usize;
            for c in &hay {
                v.push(b);
                b += c.len_utf8();
            }
            v.push(b);
            v
        };
        let lowered: Vec<char> = hay
            .iter()
            .map(|c| c.to_lowercase().next().unwrap_or(*c))
            .collect();
        let needle: Vec<char> = query.to_lowercase().chars().collect();
        if needle.is_empty() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        if needle.len() == 1 {
            let n = needle[0];
            for (i, c) in lowered.iter().enumerate() {
                if *c == n {
                    out.push((byte_at[i], byte_at[i + 1]));
                }
            }
        } else {
            let mut start = 0;
            while start + needle.len() <= lowered.len() {
                if lowered[start..start + needle.len()] == needle[..] {
                    out.push((byte_at[start], byte_at[start + needle.len()]));
                    start += needle.len();
                } else {
                    start += 1;
                }
            }
        }
        Ok(out)
    }
}

fn scan_text(
    root: &Path,
    path: &Path,
    text: &str,
    query: &str,
    case_sensitive: bool,
    use_regex: bool,
    out: &mut Vec<SearchHit>,
) -> std::io::Result<()> {
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
    for (idx, _end) in match_offsets(text, query, case_sensitive, use_regex)? {
        loop {
            let Some(off) = text[line_start..].find('\n') else {
                break;
            };
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
        let column = raw_line[..idx.saturating_sub(line_start)].chars().count() + 1;
        out.push(SearchHit {
            path: rel.clone(),
            title: title.clone(),
            line,
            column,
            snippet: make_snippet(raw_line, idx.saturating_sub(line_start), SNIPPET_LEN),
        });
    }
    Ok(())
}

/// Result of a vault-wide find-and-replace.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceError {
    /// Vault-relative path of the file that could not be processed.
    pub path: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceResult {
    pub files_changed: usize,
    pub replacements: usize,
    /// Per-file failures (unreadable, non-UTF8, write error). The batch keeps
    /// going — one locked/odd file used to abort the whole operation halfway.
    pub errors: Vec<ReplaceError>,
    /// Vault-relative paths actually modified, so the frontend can suppress
    /// watcher echoes and refresh open tabs for exactly these files.
    pub changed_paths: Vec<String>,
}

/// Replace `query` with `replacement` in every `.md` file in the vault
/// (hidden dirs skipped), writing changed files back atomically.
///
/// When `use_regex` is set, `query` is a pattern and `$1`-style capture
/// references in `replacement` work. For literal case-insensitive replaces the
/// replacement is escaped so a literal `$` is never treated as a group ref.
pub fn replace_in_vault(
    vault_root: &Path,
    query: &str,
    replacement: &str,
    case_sensitive: bool,
    use_regex: bool,
) -> std::io::Result<ReplaceResult> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(ReplaceResult {
            files_changed: 0,
            replacements: 0,
            errors: Vec::new(),
            changed_paths: Vec::new(),
        });
    }
    // Literal mode escapes the query so metacharacters match themselves.
    let pattern = if use_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let re = RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .multi_line(true) // `^`/`$` anchor per line
        .build()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e.to_string()))?;
    // In literal mode a literal `$` in the replacement must survive verbatim
    // (regex replace_all would read `$1` as a capture). `$$` is regex's escape.
    let out_replacement = if use_regex {
        replacement.to_string()
    } else {
        replacement.replace('$', "$$")
    };

    let mut files_changed = 0usize;
    let mut replacements = 0usize;
    let mut errors = Vec::new();
    let mut changed_paths = Vec::new();
    replace_walk(
        vault_root,
        vault_root,
        &re,
        &out_replacement,
        &mut files_changed,
        &mut replacements,
        &mut errors,
        &mut changed_paths,
    );
    Ok(ReplaceResult {
        files_changed,
        replacements,
        errors,
        changed_paths,
    })
}

#[allow(clippy::too_many_arguments)]
fn replace_walk(
    root: &Path,
    dir: &Path,
    re: &regex::Regex,
    replacement: &str,
    files_changed: &mut usize,
    replacements: &mut usize,
    errors: &mut Vec<ReplaceError>,
    changed_paths: &mut Vec<String>,
) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            let rel = dir.strip_prefix(root).unwrap_or(dir).to_string_lossy().into_owned();
            errors.push(ReplaceError { path: rel, error: e.to_string() });
            return;
        }
    };
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                errors.push(ReplaceError {
                    path: dir.to_string_lossy().into_owned(),
                    error: e.to_string(),
                });
                continue;
            }
        };
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            replace_walk(root, &path, re, replacement, files_changed, replacements, errors, changed_paths);
        } else if path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase() == "md")
            .unwrap_or(false)
        {
            // Fault isolation: a single unreadable/non-UTF8/unwritable file is
            // reported and skipped — the rest of the vault still gets fixed.
            let text = match std::fs::read_to_string(&path) {
                Ok(t) => t,
                Err(e) => {
                    let rel = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
                    errors.push(ReplaceError { path: rel, error: e.to_string() });
                    continue;
                }
            };
            let count = re.find_iter(&text).count();
            if count > 0 {
                let new_text = re.replace_all(&text, replacement).into_owned();
                match crate::file_io::write_file_atomic(&path, &new_text) {
                    Ok(()) => {
                        *files_changed += 1;
                        *replacements += count;
                        let rel = path
                            .strip_prefix(root)
                            .unwrap_or(&path)
                            .to_string_lossy()
                            .replace('\\', "/");
                        changed_paths.push(rel);
                    }
                    Err(e) => {
                        let rel = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
                        errors.push(ReplaceError { path: rel, error: e.to_string() });
                    }
                }
            }
        }
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
        let hits = search_vault(dir.path(), "Tauri", false, false, 100).unwrap();
        assert_eq!(hits.len(), 2);
        assert!(hits
            .iter()
            .all(|h| h.snippet.to_lowercase().contains("tauri")));
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
        let hits = search_vault(dir.path(), "needle", false, false, 100).unwrap();
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
        let hits = search_vault(dir.path(), "needle", false, false, 100).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].column, 3);
        assert_eq!(hits[1].column, 12);
    }

    #[test]
    fn case_sensitive_mode() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "Tauri tauri TAURI")]);
        let hits = search_vault(dir.path(), "tauri", true, false, 100).unwrap();
        assert_eq!(hits.len(), 1); // only the lowercase occurrence
        assert_eq!(hits[0].column, 7);
    }

    #[test]
    fn regex_matches_with_capture_aware_offsets() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "call foo(1) and foo(2) now")]);
        let hits = search_vault(dir.path(), r"foo\(\d+\)", false, true, 100).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].column, 6);
        assert_eq!(hits[1].column, 17);
    }

    #[test]
    fn regex_case_insensitive_off_when_requested() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "Foo\nfoo\nFOO")]);
        let hits = search_vault(dir.path(), "^foo$", true, true, 100).unwrap();
        assert_eq!(hits.len(), 1); // only the exact lowercase line
        assert_eq!(hits[0].line, 2);
    }

    #[test]
    fn regex_matches_whole_lines_case_insensitive() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "Foo\nfoo\nFOO")]);
        let hits = search_vault(dir.path(), "^foo$", false, true, 100).unwrap();
        assert_eq!(hits.len(), 3);
    }

    #[test]
    fn invalid_regex_is_an_error() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "content")]);
        let err = search_vault(dir.path(), "[", false, true, 100).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
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
        let hits = search_vault(dir.path(), "tauri", false, false, 100).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "docs.md");
    }

    #[test]
    fn caps_total_hits() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "hit\nhit\nhit\nhit\nhit")]);
        let hits = search_vault(dir.path(), "hit", false, false, 3).unwrap();
        assert_eq!(hits.len(), 3);
    }

    #[test]
    fn empty_query_returns_nothing() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "content")]);
        let hits = search_vault(dir.path(), "   ", false, false, 100).unwrap();
        assert!(hits.is_empty());
    }

    #[test]
    fn long_line_snippet_is_centered_and_capped() {
        let dir = tempdir().unwrap();
        let long_line = format!("{}needle{}", "x".repeat(200), "y".repeat(200));
        write_vault(dir.path(), &[("a.md", &long_line)]);
        let hits = search_vault(dir.path(), "needle", false, false, 100).unwrap();
        assert_eq!(hits.len(), 1);
        let s = &hits[0].snippet;
        // `…` is one char, so the cap is SNIPPET_LEN + two ellipsis chars.
        assert!(
            s.chars().count() <= SNIPPET_LEN + 2,
            "snippet too long: {}",
            s.len()
        );
        assert!(s.contains("needle"), "match must stay visible: {s}");
    }

    #[test]
    fn non_ascii_query_matches_exactly() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "设计文档\n关于设计 的笔记")]);
        let hits = search_vault(dir.path(), "设计", false, false, 100).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].line, 1);
        assert_eq!(hits[1].line, 2);
        assert_eq!(hits[1].column, 3); // 关于设计: 设计 starts at the 3rd char
        assert!(hits.iter().all(|h| h.snippet.contains("设计")));
    }

    #[test]
    fn case_insensitive_match_with_length_changing_lowercase_does_not_panic() {
        // U+212A KELVIN SIGN (3 bytes) lowercases to 'k' (1 byte). The old
        // whole-string to_lowercase() desynced byte offsets and panicked when
        // slicing the raw line. Search "k" case-insensitively must return the
        // match without panicking, and the column must be computed on chars.
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "x\u{212A}y")]);
        let hits = search_vault(dir.path(), "k", false, false, 100).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].column, 2); // x, KELVIN => 2nd char
    }

    #[test]
    fn replace_literal_case_sensitive() {
        let dir = tempdir().unwrap();
        write_vault(
            dir.path(),
            &[
                ("a.md", "foo bar foo"),
                ("notes/b.md", "no match here"),
                ("c.md", "FOO stays"),
            ],
        );
        let res = replace_in_vault(dir.path(), "foo", "baz", true, false).unwrap();
        assert_eq!(res.files_changed, 1);
        assert_eq!(res.replacements, 2);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
            "baz bar baz"
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("c.md")).unwrap(),
            "FOO stays"
        );
    }

    #[test]
    fn replace_isolates_per_file_failures_and_reports_changed_paths() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("good.md", "foo here")]);
        // A non-UTF8 .md file: unreadable as text, must not abort the batch.
        std::fs::write(dir.path().join("bad.md"), [0xff, 0xfe, 0x62, 0x61, 0x64]).unwrap();
        let res = replace_in_vault(dir.path(), "foo", "baz", true, false).unwrap();
        assert_eq!(res.files_changed, 1);
        assert_eq!(res.replacements, 1);
        assert_eq!(res.changed_paths, vec!["good.md".to_string()]);
        assert_eq!(res.errors.len(), 1);
        assert_eq!(res.errors[0].path, "bad.md");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("good.md")).unwrap(),
            "baz here"
        );
    }

    #[test]
    fn replace_literal_case_insensitive_keeps_dollar_literal() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "Tauri is Tauri")]);
        let res = replace_in_vault(dir.path(), "tauri", "$5", false, false).unwrap();
        assert_eq!(res.files_changed, 1);
        assert_eq!(res.replacements, 2);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
            "$5 is $5"
        );
    }

    #[test]
    fn replace_regex_uses_capture_groups() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "call foo(1) and foo(2)")]);
        let res = replace_in_vault(dir.path(), r"foo\((\d+)\)", "fn[$1]", false, true).unwrap();
        assert_eq!(res.replacements, 2);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("a.md")).unwrap(),
            "call fn[1] and fn[2]"
        );
    }

    #[test]
    fn replace_empty_query_is_noop() {
        let dir = tempdir().unwrap();
        write_vault(dir.path(), &[("a.md", "anything")]);
        let res = replace_in_vault(dir.path(), "  ", "x", false, false).unwrap();
        assert_eq!(res.files_changed, 0);
        assert_eq!(res.replacements, 0);
    }

    #[test]
    fn replace_skips_hidden_and_non_md() {
        let dir = tempdir().unwrap();
        write_vault(
            dir.path(),
            &[
                (".markion/x.md", "hit"),
                ("docs.txt", "hit"),
                ("real.md", "hit"),
            ],
        );
        let res = replace_in_vault(dir.path(), "hit", "miss", false, false).unwrap();
        assert_eq!(res.files_changed, 1);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("real.md")).unwrap(),
            "miss"
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join(".markion/x.md")).unwrap(),
            "hit"
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("docs.txt")).unwrap(),
            "hit"
        );
    }
}
