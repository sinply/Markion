//! Read-model projection of the vault into a SQLite database.
//!
//! ARCHITECTURE RULE: the `.md` files are the single source of truth. This DB
//! (`<vault>/.markion/cache.db`) is a disposable, rebuildable cache that backs
//! structured views (library home, folder tables). It is NEVER authoritative:
//! any code path may delete it and call [`rebuild_all`] to reconstruct it from
//! the files. Nothing here writes note content back to disk.
//!
//! Data flow (one-way):
//!   md files --(create/modify/delete events, save hooks)--> update_one/remove_path
//!   UI queries --> query_library / query_folder_table

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::Path;

const CACHE_FILE: &str = ".markion/cache.db";
const SCHEMA_VERSION: i32 = 1;

// ---------------------------------------------------------------------------
// Public data types (serde -> frontend)
// ---------------------------------------------------------------------------

/// One row of the library home: a document card.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryEntry {
    pub path: String,
    pub title: String,
    #[serde(rename = "mtimeSecs")]
    pub mtime_secs: i64,
    #[serde(rename = "wordCount")]
    pub word_count: i64,
    pub summary: String,
    pub tags: Vec<String>,
}

/// A column of the folder table with its inferred type.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TableColumn {
    pub name: String,
    /// "text" | "number" | "date" | "tags"
    pub r#type: String,
}

/// Folder table view payload: columns + rows (values keyed by column name).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderTable {
    pub columns: Vec<TableColumn>,
    pub rows: Vec<FolderTableRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderTableRow {
    pub path: String,
    pub name: String,
    /// Property values keyed by column name; missing keys render empty.
    pub values: std::collections::BTreeMap<String, String>,
}

// ---------------------------------------------------------------------------
// Frontmatter / text extraction (mirrors the simplified parser in
// src/lib/frontmatter.ts: `key: value` lines between `---` fences)
// ---------------------------------------------------------------------------

/// Parsed frontmatter: ordered (key, value) pairs plus inline list items.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Frontmatter {
    pub props: Vec<(String, String)>,
}

/// Extract and parse a YAML-ish frontmatter block. Returns `None` when the
/// document has no frontmatter. Tolerant: unknown shapes are skipped.
pub fn extract_frontmatter(text: &str) -> Option<Frontmatter> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut lines = text.lines();
    let first = lines.next()?.trim_end();
    if first != "---" {
        return None;
    }
    let mut fm = Frontmatter::default();
    let mut current_key: Option<String> = None;
    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            return Some(fm);
        }
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(item) = trimmed.strip_prefix("- ") {
            // List item under the previous key ("tags:\n  - a"): append.
            if let Some(key) = &current_key {
                let item = item.trim().trim_matches('"').trim_matches('\'');
                for existing in fm.props.iter_mut() {
                    if &existing.0 == key {
                        if existing.1.is_empty() {
                            existing.1 = item.to_string();
                        } else {
                            existing.1 = format!("{}, {}", existing.1, item);
                        }
                        break;
                    }
                }
            }
            continue;
        }
        let idx = match trimmed.find(':') {
            Some(i) if i > 0 => i,
            _ => continue,
        };
        let key = trimmed[..idx].trim().to_string();
        let value = trimmed[idx + 1..]
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        current_key = Some(key.clone());
        // Later duplicates win (matches the frontend parser's behavior of
        // taking the last assignment when looked up).
        if let Some(existing) = fm.props.iter_mut().find(|(k, _)| *k == key) {
            existing.1 = value;
        } else {
            fm.props.push((key, value));
        }
    }
    // Unterminated frontmatter: treat as absent.
    None
}

/// First non-heading, non-fence, non-empty body line, stripped of common
/// markdown markers, clamped to ~80 chars — the card summary.
pub fn extract_summary(text: &str) -> String {
    let body = match text.find("\n---\n") {
        // Skip a closed frontmatter block.
        Some(i) if text.starts_with("---") => &text[i + 5..],
        _ => text,
    };
    let mut in_fence = false;
    for line in body.lines() {
        let t = line.trim();
        if t.starts_with("```") || t.starts_with("~~~") {
            // A fence marker toggles state — but a self-closing single line
            // (```code```) contains an even number of markers and must not
            // swallow the rest of the document.
            let markers = t.matches("```").count() + t.matches("~~~").count();
            if markers % 2 == 1 {
                in_fence = !in_fence;
            }
            continue;
        }
        if in_fence || t.is_empty() || t.starts_with('#') {
            continue;
        }
        let cleaned: String = t
            .chars()
            .filter(|ch| !matches!(ch, '|' | '`' | '*' | '_' | '~' | '>' | '[' | ']' | '!'))
            .collect();
        let cleaned = cleaned.trim();
        if cleaned.is_empty() {
            continue;
        }
        let mut out: String = cleaned.chars().take(80).collect();
        if cleaned.chars().count() > 80 {
            out.push('…');
        }
        return out;
    }
    String::new()
}

/// Word count where CJK chars count individually and other words count as one.
pub fn word_count(text: &str) -> i64 {
    let mut count = 0i64;
    let mut in_word = false;
    for ch in text.chars() {
        if is_cjk(ch) {
            count += 1;
            in_word = false;
        } else if ch.is_alphanumeric() {
            if !in_word {
                count += 1;
                in_word = true;
            }
        } else {
            in_word = false;
        }
    }
    count
}

fn is_cjk(ch: char) -> bool {
    matches!(ch as u32,
        0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0x20000..=0x2A6DF | 0xF900..=0xFAFF)
}

fn strip_title_ext(name: &str) -> String {
    name.strip_suffix(".md")
        .or_else(|| name.strip_suffix(".MD"))
        .map(|s| s.to_string())
        .unwrap_or_else(|| name.to_string())
}

// ---------------------------------------------------------------------------
// Column type inference for folder tables
// ---------------------------------------------------------------------------

/// Infer a column type from all non-empty values: all integers/decimals ->
/// "number", all YYYY-MM-DD -> "date", multi-part comma values -> "tags",
/// otherwise "text".
pub fn infer_column_type(values: &[&str]) -> &'static str {
    let non_empty: Vec<&str> = values.iter().copied().filter(|v| !v.trim().is_empty()).collect();
    if non_empty.is_empty() {
        return "text";
    }
    let number_re = regex::Regex::new(r"^-?\d+(\.\d+)?$").unwrap();
    let date_re = regex::Regex::new(r"^\d{4}-\d{2}-\d{2}$").unwrap();
    if non_empty.iter().all(|v| number_re.is_match(v.trim())) {
        return "number";
    }
    if non_empty.iter().all(|v| date_re.is_match(v.trim())) {
        return "date";
    }
    if non_empty.iter().any(|v| v.contains(',') && v.split(',').count() > 1) {
        return "tags";
    }
    "text"
}

/// Build folder-table columns + rows from raw per-file property lists.
/// Columns are the first-seen union of keys (the row title column is implicit).
pub fn build_folder_table(
    entries: &[(String, String, Vec<(String, String)>)], // (path, name, props)
) -> FolderTable {
    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<FolderTableRow> = Vec::new();
    for (path, name, props) in entries {
        let mut values = std::collections::BTreeMap::new();
        for (k, v) in props {
            if !columns.iter().any(|c| c == k) {
                columns.push(k.clone());
            }
            values.insert(k.clone(), v.clone());
        }
        rows.push(FolderTableRow {
            path: path.clone(),
            name: name.clone(),
            values,
        });
    }
    let typed = columns
        .iter()
        .map(|c| {
            let vals: Vec<&str> = rows
                .iter()
                .map(|r| r.values.get(c).map(|s| s.as_str()).unwrap_or(""))
                .collect();
            TableColumn {
                name: c.clone(),
                r#type: infer_column_type(&vals).to_string(),
            }
        })
        .collect();
    FolderTable {
        columns: typed,
        rows,
    }
}

// ---------------------------------------------------------------------------
// DB plumbing
// ---------------------------------------------------------------------------

fn open_conn(vault_root: &Path) -> rusqlite::Result<Connection> {
    let dir = vault_root.join(".markion");
    std::fs::create_dir_all(&dir).ok();
    let conn = Connection::open(vault_root.join(CACHE_FILE))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(&format!(
        "PRAGMA user_version = {SCHEMA_VERSION};
         CREATE TABLE IF NOT EXISTS documents (
             path TEXT PRIMARY KEY,
             title TEXT NOT NULL,
             folder TEXT NOT NULL,
             mtime_secs INTEGER NOT NULL DEFAULT 0,
             word_count INTEGER NOT NULL DEFAULT 0,
             summary TEXT NOT NULL DEFAULT ''
         );
         CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder);
         CREATE TABLE IF NOT EXISTS properties (
             path TEXT NOT NULL,
             key TEXT NOT NULL,
             value TEXT NOT NULL DEFAULT '',
             PRIMARY KEY (path, key)
         );
         CREATE TABLE IF NOT EXISTS tags (
             path TEXT NOT NULL,
             tag TEXT NOT NULL,
             PRIMARY KEY (path, tag)
         );"
    ))?;
    Ok(())
}

fn is_our_db(conn: &Connection) -> bool {
    conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
        .map(|v| v == SCHEMA_VERSION as i64)
        .unwrap_or(false)
}

fn parent_folder(path: &str) -> String {
    match path.rfind('/') {
        Some(i) => path[..i].to_string(),
        None => String::new(),
    }
}

/// All `.md` files under the vault (relative, forward-slash), sorted. Skips
/// every dot-entry (`.markion`, `.obsidian`, `.git`, …) — hidden files never
/// enter the projection, matching the file tree's default filter.
pub fn walk_md(vault_root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let root = vault_root.to_path_buf();
    let walker = walkdir::WalkDir::new(&root)
        .into_iter()
        .filter_entry(|e| {
            // The vault root itself (depth 0) may legitimately be a dotdir
            // (e.g. tempfile's `.tmpXYZ`); prune only entries BELOW it.
            e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.')
        })
        .filter_map(|e| e.ok());
    for entry in walker {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.to_lowercase().ends_with(".md") {
            continue;
        }
        if let Ok(rel) = entry.path().strip_prefix(&root) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
    out.sort();
    out
}

/// Everything extracted from one note, ready to insert.
struct DocRecord {
    path: String,
    title: String,
    folder: String,
    mtime_secs: i64,
    word_count: i64,
    summary: String,
    props: Vec<(String, String)>,
    tags: Vec<String>,
}

/// A vault-relative path is hidden if ANY segment starts with a dot
/// (`.obsidian/x.md`, `.markion/cache.db`, `notes/.x.md`, …). Hidden paths
/// never enter the projection, no matter which entry point tries.
pub fn is_hidden_path(rel_path: &str) -> bool {
    rel_path.split('/').any(|seg| seg.starts_with('.'))
}

/// Parse a note's text into an insertable record. Pure (no I/O).
fn parse_document(rel_path: &str, text: &str, mtime_secs: i64) -> DocRecord {
    let stem = strip_title_ext(rel_path.rsplit('/').next().unwrap_or(rel_path));
    let fm = extract_frontmatter(text).unwrap_or_default();
    // Display title prefers an explicit frontmatter `title` (Yuque-style
    // document metadata); otherwise the file-name stem.
    let title = fm
        .props
        .iter()
        .find(|(k, v)| k == "title" && !v.trim().is_empty())
        .map(|(_, v)| v.clone())
        .unwrap_or(stem);
    let tags = fm
        .props
        .iter()
        .filter(|(k, _)| k == "tags")
        .flat_map(|(_, v)| v.split(','))
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    DocRecord {
        path: rel_path.to_string(),
        title,
        folder: parent_folder(rel_path),
        mtime_secs,
        word_count: word_count(text),
        summary: extract_summary(text),
        props: fm.props,
        tags,
    }
}

fn mtime_of(abs: &Path) -> i64 {
    std::fs::metadata(abs)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Insert/refresh one record inside an open transaction.
fn insert_doc(
    tx: &rusqlite::Transaction,
    rec: &DocRecord,
) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT INTO documents (path, title, folder, mtime_secs, word_count, summary)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(path) DO UPDATE SET title=?2, folder=?3, mtime_secs=?4, word_count=?5, summary=?6",
        rusqlite::params![rec.path, rec.title, rec.folder, rec.mtime_secs, rec.word_count, rec.summary],
    )?;
    tx.execute("DELETE FROM properties WHERE path = ?1", [&rec.path])?;
    tx.execute("DELETE FROM tags WHERE path = ?1", [&rec.path])?;
    for (k, v) in &rec.props {
        tx.execute(
            "INSERT OR REPLACE INTO properties (path, key, value) VALUES (?1, ?2, ?3)",
            rusqlite::params![rec.path, k, v],
        )?;
    }
    for t in &rec.tags {
        tx.execute(
            "INSERT OR REPLACE INTO tags (path, tag) VALUES (?1, ?2)",
            rusqlite::params![rec.path, t],
        )?;
    }
    Ok(())
}

/// Insert or refresh one document row (+ properties/tags) from disk.
/// Missing file removes the row. Best-effort: errors are returned but callers
/// may ignore them — the projection can always be rebuilt.
pub fn update_one(vault_root: &Path, rel_path: &str) -> Result<(), String> {
    if is_hidden_path(rel_path) {
        return Ok(()); // dot-entries are invisible to the projection
    }
    let abs = vault_root.join(rel_path);
    if !abs.is_file() {
        return remove_path(vault_root, rel_path);
    }
    let text = std::fs::read_to_string(&abs).map_err(|e| e.to_string())?;
    let rec = parse_document(rel_path, &text, mtime_of(&abs));

    let mut conn = open_conn(vault_root).map_err(|e| e.to_string())?;
    if !is_our_db(&conn) {
        init_schema(&conn).map_err(|e| e.to_string())?;
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    insert_doc(&tx, &rec).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// Remove a document (and its properties/tags). Paths ending in `/` or an
/// existing directory remove every document under that prefix.
pub fn remove_path(vault_root: &Path, rel_path: &str) -> Result<(), String> {
    if is_hidden_path(rel_path) {
        return Ok(()); // nothing hidden was ever inserted
    }
    let mut conn = open_conn(vault_root).map_err(|e| e.to_string())?;
    if !is_our_db(&conn) {
        return Ok(()); // nothing to remove in a foreign/empty db
    }
    let prefix = format!("{}/%", rel_path.trim_end_matches('/'));
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for table in ["properties", "tags"] {
        tx.execute(
            &format!("DELETE FROM {table} WHERE path = ?1 OR path LIKE ?2"),
            rusqlite::params![rel_path, prefix],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "DELETE FROM documents WHERE path = ?1 OR path LIKE ?2",
        rusqlite::params![rel_path, prefix],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// Rebuild the whole projection from the files on disk (drop-and-recreate).
pub fn rebuild_all(vault_root: &Path) -> Result<(), String> {
    rebuild_all_with_progress(vault_root, None)
}

/// Same as [`rebuild_all`], reporting `(done, total)` through `progress` so
/// the UI can show a determinate bar on first load.
pub fn rebuild_all_with_progress(
    vault_root: &Path,
    progress: Option<&dyn Fn(usize, usize)>,
) -> Result<(), String> {
    let db = vault_root.join(CACHE_FILE);
    if let Some(dir) = db.parent() {
        std::fs::create_dir_all(dir).ok();
    }
    // Remove any existing (possibly corrupt / foreign) database first.
    for suffix in ["", "-wal", "-shm"] {
        let p = vault_root.join(format!("{CACHE_FILE}{suffix}"));
        if p.exists() {
            std::fs::remove_file(&p).map_err(|e| e.to_string())?;
        }
    }
    // Single connection + single transaction: a full rebuild of even a few
    // thousand notes stays well under a second (per-file transactions were
    // ~100x slower and blocked the library home with a blank screen).
    let files = walk_md(vault_root);
    let total = files.len();
    let mut conn = open_conn(vault_root).map_err(|e| e.to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (i, f) in files.iter().enumerate() {
        let abs = vault_root.join(f);
        // Best-effort: unreadable/binary files are skipped, never fatal.
        if let Ok(text) = std::fs::read_to_string(&abs) {
            let rec = parse_document(f, &text, mtime_of(&abs));
            insert_doc(&tx, &rec).ok(); // skip rows that violate constraints
        }
        if let Some(cb) = progress {
            cb(i + 1, total);
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Ensure the projection exists, belongs to this vault, and is non-empty when
/// the vault is not. Cheap checks only — per-file freshness relies on the
/// save hooks and watcher events.
pub fn ensure_ready(vault_root: &Path) -> Result<(), String> {
    ensure_ready_with_progress(vault_root, None)
}

pub fn ensure_ready_with_progress(
    vault_root: &Path,
    progress: Option<&dyn Fn(usize, usize)>,
) -> Result<(), String> {
    let has_files = !walk_md(vault_root).is_empty();
    // Scope the probe connection so it is CLOSED before a possible rebuild —
    // on Windows an open handle blocks deleting the very same db file.
    let (usable, rows) = {
        let conn = open_conn(vault_root);
        match &conn {
            Ok(c) if is_our_db(c) => (
                true,
                c.query_row("SELECT COUNT(*) FROM documents", [], |r| r.get::<_, i64>(0))
                    .unwrap_or(-1),
            ),
            _ => (false, 0),
        }
    };
    if !usable || (has_files && rows <= 0) {
        return rebuild_all_with_progress(vault_root, progress);
    }
    Ok(())
}

/// Library home entries: newest-modified first, optionally scoped to a folder
/// (prefix match on the folder column). Self-heals the projection first.
pub fn query_library(vault_root: &Path, folder: Option<&str>) -> Result<Vec<LibraryEntry>, String> {
    ensure_ready(vault_root)?;
    query_library_ready(vault_root, folder)
}

/// The query half of [`query_library`] — assumes `ensure_ready` already ran
/// (the command layer runs it with a progress reporter).
pub fn query_library_ready(
    vault_root: &Path,
    folder: Option<&str>,
) -> Result<Vec<LibraryEntry>, String> {
    let conn = open_conn(vault_root).map_err(|e| e.to_string())?;
    // Folder filter = exact folder OR anything under it ("folder/%").
    let prefix = folder.as_ref().map(|f| format!("{f}/%"));
    let mut stmt = conn
        .prepare(
            "SELECT d.path, d.title, d.mtime_secs, d.word_count, d.summary
             FROM documents d
             WHERE (?1 IS NULL OR d.folder = ?1 OR d.folder LIKE ?2)
             ORDER BY d.mtime_secs DESC",
        )
        .map_err(|e| e.to_string())?;
    let mut out: Vec<LibraryEntry> = stmt
        .query_map(rusqlite::params![folder, prefix], |row| {
            Ok(LibraryEntry {
                path: row.get(0)?,
                title: row.get(1)?,
                mtime_secs: row.get(2)?,
                word_count: row.get(3)?,
                summary: row.get(4)?,
                tags: Vec::new(),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    // Attach tags in one query to avoid N+1 round trips.
    let mut tag_stmt = conn
        .prepare("SELECT tag FROM tags WHERE path = ?1 ORDER BY tag")
        .map_err(|e| e.to_string())?;
    for entry in &mut out {
        entry.tags = tag_stmt
            .query_map([&entry.path], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|t| t.ok())
            .collect();
    }
    Ok(out)
}

/// Folder table: direct `.md` children of `folder`, columns inferred from the
/// union of their frontmatter keys. Reads from DISK (not the projection) so a
/// just-created note appears immediately even before the watcher tick.
pub fn query_folder_table(vault_root: &Path, folder: &str) -> Result<FolderTable, String> {
    let root = vault_root.to_path_buf();
    let dir_abs = if folder.is_empty() {
        root.clone()
    } else {
        root.join(folder)
    };
    let mut entries: Vec<(String, String, Vec<(String, String)>)> = Vec::new();
    let rd = match std::fs::read_dir(&dir_abs) {
        Ok(rd) => rd,
        Err(e) => return Err(e.to_string()),
    };
    for e in rd.filter_map(|e| e.ok()) {
        let name = e.file_name().to_string_lossy().to_string();
        // Hidden (dot) entries never appear in the table view.
        if name.starts_with('.') {
            continue;
        }
        if !name.to_lowercase().ends_with(".md") || !e.path().is_file() {
            continue;
        }
        let rel = if folder.is_empty() {
            name.clone()
        } else {
            format!("{folder}/{name}")
        };
        let props = std::fs::read_to_string(e.path())
            .ok()
            .and_then(|text| extract_frontmatter(&text))
            .map(|fm| fm.props)
            .unwrap_or_default();
        entries.push((rel, strip_title_ext(&name), props));
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(build_folder_table(&entries))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn write(dir: &Path, rel: &str, content: &str) {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, content).unwrap();
    }

    #[test]
    fn frontmatter_parses_key_value_pairs() {
        let fm = extract_frontmatter("---\ntitle: Hello\ndate: 2026-08-18\nrating: \"4.5\"\n---\n\nbody").unwrap();
        assert_eq!(fm.props[0], ("title".into(), "Hello".into()));
        assert_eq!(fm.props[1], ("date".into(), "2026-08-18".into()));
        assert_eq!(fm.props[2], ("rating".into(), "4.5".into()));
    }

    #[test]
    fn frontmatter_list_items_join_the_previous_key() {
        let fm = extract_frontmatter("---\ntags:\n  - rust\n  - tauri\n---\nx").unwrap();
        assert_eq!(fm.props.len(), 1);
        assert_eq!(fm.props[0], ("tags".into(), "rust, tauri".into()));
    }

    #[test]
    fn frontmatter_absent_or_unterminated_returns_none() {
        assert!(extract_frontmatter("no fence here").is_none());
        assert!(extract_frontmatter("---\ntitle: x").is_none()); // never closed
    }

    #[test]
    fn summary_skips_frontmatter_headings_and_fences() {
        let s = extract_summary("---\ntitle: t\n---\n\n# Heading\n```rust\ncode line\n```\n\nReal **first** line");
        assert_eq!(s, "Real first line");
    }

    #[test]
    fn summary_self_closing_fence_line_does_not_swallow_body() {
        let s = extract_summary("```code```\nActual text");
        assert_eq!(s, "Actual text");
    }

    #[test]
    fn summary_clamps_to_eighty_chars() {
        let long = "x".repeat(300);
        let s = extract_summary(&long);
        assert_eq!(s.chars().count(), 81); // 80 + ellipsis
        assert!(s.ends_with('…'));
    }

    #[test]
    fn word_counts_cjk_chars_and_latin_words() {
        assert_eq!(word_count("hello world"), 2);
        assert_eq!(word_count("你好世界"), 4);
        assert_eq!(word_count("hi 你"), 2);
    }

    #[test]
    fn infer_column_types() {
        assert_eq!(infer_column_type(&["1", "2.5", ""]), "number");
        assert_eq!(infer_column_type(&["2026-01-01", "2026-08-18"]), "date");
        assert_eq!(infer_column_type(&["a, b", "c"]), "tags");
        assert_eq!(infer_column_type(&["hello", "world"]), "text");
        assert_eq!(infer_column_type(&["", ""]), "text");
    }

    #[test]
    fn build_folder_table_unions_keys_in_first_seen_order() {
        let table = build_folder_table(&[
            ("a.md".into(), "a".into(), vec![("status".into(), "todo".into()), ("due".into(), "2026-01-01".into())]),
            ("b.md".into(), "b".into(), vec![("status".into(), "done".into()), ("extra".into(), "x".into())]),
        ]);
        let names: Vec<&str> = table.columns.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["status", "due", "extra"]);
        assert_eq!(table.columns[0].r#type, "text");
        assert_eq!(table.columns[1].r#type, "date");
        assert_eq!(table.rows[1].values.get("extra").unwrap(), "x");
        assert!(table.rows[0].values.get("extra").is_none());
    }

    #[test]
    fn rebuild_query_and_incremental_flow() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        write(root, "a.md", "---\ntitle: Custom\ntags: work, plan\n---\n\nFirst paragraph here");
        write(root, "notes/b.md", "# Notes\nBody text with 内容");

        rebuild_all(root).unwrap();

        let lib = query_library(root, None).unwrap();
        assert_eq!(lib.len(), 2);
        let a = lib.iter().find(|e| e.path == "a.md").unwrap();
        assert_eq!(a.title, "Custom"); // frontmatter title wins over filename
        assert!(a.summary.starts_with("First paragraph"));
        assert_eq!(a.tags, vec!["plan", "work"]);
        let b = lib.iter().find(|e| e.path == "notes/b.md").unwrap();
        assert_eq!(b.title, "b"); // no frontmatter -> filename stem

        let scoped = query_library(root, Some("notes")).unwrap();
        assert_eq!(scoped.len(), 1);
        assert_eq!(scoped[0].path, "notes/b.md");

        // Incremental: modify one file, remove another.
        write(root, "a.md", "---\ntitle: Changed\n---\n\nNew summary");
        update_one(root, "a.md").unwrap();
        let lib = query_library(root, None).unwrap();
        let a = lib.iter().find(|e| e.path == "a.md").unwrap();
        assert_eq!(a.title, "Changed");
        assert_eq!(a.tags.len(), 0); // stale tags cleared by update_one

        remove_path(root, "notes/b.md").unwrap();
        assert_eq!(query_library(root, None).unwrap().len(), 1);
    }

    #[test]
    fn corrupt_db_is_rebuilt_by_ensure_ready() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        write(root, "only.md", "content");
        std::fs::create_dir_all(root.join(".markion")).unwrap();
        std::fs::write(root.join(CACHE_FILE), "this is not sqlite {{{").unwrap();
        ensure_ready(root).unwrap(); // must heal, not error
        let lib = query_library(root, None).unwrap();
        assert_eq!(lib.len(), 1);
    }

    #[test]
    fn folder_table_reads_from_disk_direct_children_only() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        write(root, "top.md", "---\nstatus: todo\nwhen: 2026-02-03\nscore: 7\n---\nb");
        write(root, "notes/nested.md", "---\nstatus: done\n---\nb");

        let table = query_folder_table(root, "").unwrap();
        assert_eq!(table.rows.len(), 1); // nested folder excluded
        assert_eq!(table.rows[0].name, "top");
        let status = table.columns.iter().find(|c| c.name == "status").unwrap();
        assert_eq!(status.r#type, "text");
        let when = table.columns.iter().find(|c| c.name == "when").unwrap();
        assert_eq!(when.r#type, "date");
        let score = table.columns.iter().find(|c| c.name == "score").unwrap();
        assert_eq!(score.r#type, "number");
    }

    #[test]
    fn hidden_paths_never_enter_the_projection() {
        assert!(is_hidden_path(".obsidian/x.md"));
        assert!(is_hidden_path("notes/.draft.md"));
        assert!(!is_hidden_path("notes/draft.md"));

        let dir = tempdir().unwrap();
        let root = dir.path();
        write(root, "real.md", "# real");
        write(root, ".obsidian/note.md", "# hidden");
        write(root, ".secret.md", "# hidden too");
        // Watcher-style upserts of hidden paths must be no-ops…
        update_one(root, ".obsidian/note.md").unwrap();
        update_one(root, ".secret.md").unwrap();
        ensure_ready(root).unwrap();
        let lib = query_library(root, None).unwrap();
        assert_eq!(lib.len(), 1);
        assert_eq!(lib[0].path, "real.md");
        // …and removals of hidden paths must not error either.
        remove_path(root, ".obsidian").unwrap();
        assert_eq!(query_library(root, None).unwrap().len(), 1);
    }
}
