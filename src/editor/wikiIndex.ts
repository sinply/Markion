/**
 * In-memory resolution index for `[[wikilink]]` targets. Populated from the
 * vault file list by useWikiIndex(); consumed by the live-preview renderer,
 * the wikilink click handler, and the autocomplete source. Stem matching
 * mirrors the Rust `backlinks.rs` convention: filename without `.md`,
 * case-insensitive, `path/name` matches on the last path segment.
 */
const stemToPath = new Map<string, string>();
const pathSet = new Set<string>();

export interface WikiFile {
  name: string;
  path: string;
}

/** Rebuild the index from the current vault's markdown file list. */
export function setWikiIndex(files: WikiFile[]): void {
  stemToPath.clear();
  pathSet.clear();
  for (const f of files) {
    if (!/\.md$/i.test(f.name)) continue;
    const stem = f.name.replace(/\.md$/i, "").toLowerCase();
    // First occurrence wins, matching Obsidian's "nearest wins" feel; the
    // graph/backlinks use the same stem -> first path mapping.
    if (!stemToPath.has(stem)) stemToPath.set(stem, f.path);
    pathSet.add(f.path);
  }
}

/** All known stems (lowercased) for autocomplete, with their display paths. */
export function wikiStems(): { stem: string; path: string }[] {
  return Array.from(stemToPath.entries()).map(([stem, path]) => ({ stem, path }));
}

/** True if the exact relative path is a known markdown file. */
export function isWikiPath(path: string): boolean {
  return pathSet.has(path);
}

/**
 * Resolve a wikilink target (`name`, `path/name`, or `...|alias`) to a
 * relative vault path, or null if no file matches. Alias and leading path
 * segments are stripped, then the stem is matched case-insensitively.
 */
export function resolveWikiLink(target: string): string | null {
  const withoutAlias = target.split("|")[0];
  const stem = withoutAlias.split("/").pop() ?? withoutAlias;
  const key = stem.trim().toLowerCase();
  if (!key) return null;
  return stemToPath.get(key) ?? null;
}

/** Visible text for a wikilink token: alias if present, else the basename. */
export function wikiLabel(target: string): string {
  const parts = target.split("|");
  if (parts.length > 1 && parts[1].trim()) return parts[1].trim();
  return target.split("/").pop() ?? target;
}
