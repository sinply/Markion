/**
 * Obsidian-Base-style `.base` file parser/serializer.
 *
 * A `.base` file is a small YAML-ish document:
 *
 *   folder: <vault-relative folder path>
 *   fields:
 *     - name: <frontmatter key>
 *       type: text | number | date | tags   # optional, default = text
 *
 * The folder's `.md` files are the rows; each row's `fields` values are read
 * from the file's YAML frontmatter.
 */

export type FieldType = "text" | "number" | "date" | "tags";

export interface BaseField {
  name: string;
  type: FieldType;
}

export interface BaseDefinition {
  folder: string;
  fields: BaseField[];
}

const VALID_TYPES = new Set<FieldType>(["text", "number", "date", "tags"]);

/** A single row in the database table. `path` is vault-relative; `name` is the
 *  basename without the `.md` extension (used as the row title). `values` is
 *  keyed by field name; missing keys map to "" (rendered as an empty cell). */
export interface BaseRow {
  path: string;
  name: string;
  values: Record<string, string>;
}

/** Sort order for a column. `null` = default (row title / file name). */
export type SortDir = "asc" | "desc" | null;

export interface SortState {
  field: string; // "" = row title (file name)
  dir: SortDir;
}

/** Lower-case the whole string. Used for case-insensitive contains / sort. */
function lc(s: string): string {
  return s.toLowerCase();
}

/** Strip surrounding single or double quotes (mirrors `parseFrontmatter`). */
function unquote(v: string): string {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Quote a scalar when YAML would otherwise mis-parse it (numbers, booleans,
 *  empty, special chars). Mirrors `serializeFrontmatter` quoting rules so
 *  parse -> serialize round-trips are lossless. */
function yamlScalar(value: string): string {
  if (value === "") return "";
  const needsQuote =
    /[:#\[\]{}&*!|>'"%@`\n]/.test(value) ||
    /^\s|\s$/.test(value) ||
    /^(true|false|null|yes|no|on|off)$/i.test(value);
  return needsQuote ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/** Parse a `.base` text into a definition. Tolerant:
 *   - ignores blank lines and `# comment` lines
 *   - any unknown `fields:` item shape is dropped
 *   - returns `{ folder: "", fields: [] }` when the file is empty / unparsable
 */
export function parseBaseFile(text: string): BaseDefinition {
  const lines = text.split(/\r?\n/);
  let folder = "";
  const fields: BaseField[] = [];
  let inFields = false;
  let pendingName: string | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim() || line.trim().startsWith("#")) continue;
    // Field list item: "- name: foo" (may be indented).
    const listItem = /^\s*-\s+/.exec(line);
    if (inFields && listItem) {
      const body = line.slice(listItem[0].length).trim();
      // body is "name: foo" or "type: number"
      const idx = body.indexOf(":");
      if (idx <= 0) continue;
      const key = body.slice(0, idx).trim();
      const val = unquote(body.slice(idx + 1));
      if (key === "name") {
        pendingName = val;
        // flush previous if we collected it without a following type
      } else if (key === "type") {
        if (pendingName && VALID_TYPES.has(val as FieldType)) {
          fields.push({ name: pendingName, type: val as FieldType });
        }
        // Whether or not the type was valid, drop the pending name so an
        // unknown type never silently falls back to "text" later.
        pendingName = null;
      }
      continue;
    }
    // Inside a fields block: a sub-line like "    type: text" must attach to
    // the most recent "- name: ..." entry instead of being treated as a
    // top-level key.
    if (inFields && !listItem) {
      const subIdx = line.indexOf(":");
      if (subIdx > 0) {
        const subKey = line.slice(0, subIdx).trim();
        const subVal = unquote(line.slice(subIdx + 1).trim());
        if (subKey === "type") {
          if (pendingName && VALID_TYPES.has(subVal as FieldType)) {
            fields.push({ name: pendingName, type: subVal as FieldType });
          }
          // Drop pending whether the type was valid or not (see list-item branch).
          pendingName = null;
        }
      }
      continue;
    }
    // Top-level "key: value"
    const topIdx = line.indexOf(":");
    if (topIdx <= 0) continue;
    const topKey = line.slice(0, topIdx).trim();
    const topVal = unquote(line.slice(topIdx + 1).trim());
    if (topKey === "folder") {
      folder = topVal;
      inFields = false;
    } else if (topKey === "fields") {
      inFields = true;
    }
    // unknown top-level key: skip silently
  }
  // If a "- name: ..." item was the last line with no following type, push it
  // with the default type ("text"). Same happens when an empty `fields:` block
  // is followed by other top-level keys.
  if (pendingName) {
    fields.push({ name: pendingName, type: "text" });
  }
  return { folder, fields };
}

/** Serialize a definition back into `.base` text (trailing newline). */
export function serializeBaseFile(def: BaseDefinition): string {
  const lines: string[] = [];
  lines.push(`folder: ${yamlScalar(def.folder)}`);
  if (def.fields.length > 0) {
    lines.push("fields:");
    for (const f of def.fields) {
      lines.push(`  - name: ${yamlScalar(f.name)}`);
      lines.push(`    type: ${f.type}`);
    }
  }
  return lines.join("\n") + "\n";
}

/** Default sort: row title (file name) ascending. */
export const DEFAULT_SORT: SortState = { field: "", dir: null };

/** Apply a sort/filter pipeline to a row set. Pure (no I/O). `filters` is a
 *  map of field name -> substring query (empty = no filter on that column).
 *  Matching is case-insensitive substring. When `sort.field === ""` we sort by
 *  row title (file name). `sort.dir === null` keeps the input order. */
/** Numeric-aware comparison: pure numbers sort numerically ("10" after "9",
 *  not between "1" and "2"); ISO timestamps already compare chronologically
 *  as strings; everything else falls back to codepoint order on the
 *  lowercased text. */
function compareCellValues(a: string, b: string): number {
  const na = a.trim();
  const nb = b.trim();
  const numRe = /^-?\d+(?:\.\d+)?$/;
  if (numRe.test(na) && numRe.test(nb)) {
    const fa = Number(na);
    const fb = Number(nb);
    if (fa < fb) return -1;
    if (fa > fb) return 1;
    return 0;
  }
  // ISO timestamps already compare chronologically as strings; text falls
  // back to CASE-INSENSITIVE order (the previous behavior).
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return la < lb ? -1 : la > lb ? 1 : 0;
}

export function sortAndFilterRows(
  rows: BaseRow[],
  sort: SortState,
  filters: Record<string, string>,
): BaseRow[] {
  const filtered = rows.filter((r) => {
    for (const [key, raw] of Object.entries(filters)) {
      const q = raw.trim();
      if (!q) continue;
      const cell = lc(r.values[key] ?? "");
      if (!cell.includes(lc(q))) return false;
    }
    return true;
  });
  if (sort.dir === null) return filtered;
  const field = sort.field;
  const get = (r: BaseRow) =>
    field === "" ? r.name : (r.values[field] ?? "");
  const dir = sort.dir === "asc" ? 1 : -1;
  // stable sort: copy first, then sort by tuple (key, originalIndex)
  const indexed = filtered.map((r, i) => ({ r, i }));
  indexed.sort((a, b) => {
    const cmp = compareCellValues(get(a.r), get(b.r));
    if (cmp !== 0) return cmp * dir;
    return a.i - b.i;
  });
  return indexed.map((x) => x.r);
}

/** Cycle a column's sort direction: null -> asc -> desc -> null. */
export function nextSortDir(current: SortDir): SortDir {
  if (current === null) return "asc";
  if (current === "asc") return "desc";
  return null;
}

/** Deduplicate rows by path (keep the first occurrence). Used by the dialog
 *  to harden against tree updates that may report the same file twice. */
export function dedupeRows(rows: BaseRow[]): BaseRow[] {
  const seen = new Set<string>();
  const out: BaseRow[] = [];
  for (const r of rows) {
    if (seen.has(r.path)) continue;
    seen.add(r.path);
    out.push(r);
  }
  return out;
}
