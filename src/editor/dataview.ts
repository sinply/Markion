/**
 * Minimal Obsidian-Dataview `table` query support.
 *
 * Supported form (the one every real note uses):
 *
 *   table file.mtime AS "修改时间", file.size AS "字节大小", tags
 *   from "FPGA Notes/Study Notes/SDR软件无线电"
 *   sort  file.name asc
 *
 * - `table` columns: comma-separated; each is a field optionally aliased
 *   with AS "Label". Fields: file.name / file.mtime / file.ctime /
 *   file.size, or a bare frontmatter key (tags, status, …).
 * - `from "<folder>"`: vault-relative folder, RECURSIVE (matches Obsidian).
 * - `sort <field> [asc|desc]`.
 */

export interface DataviewColumn {
  /** Raw field reference: file.name | file.mtime | file.ctime | file.size | prop key */
  field: string;
  /** Display label: the AS alias, or the field itself. */
  label: string;
}

export interface DataviewQuery {
  columns: DataviewColumn[];
  from: string;
  sortField: string | null;
  sortDir: "asc" | "desc";
}

/** Parse a ```dataview fence body. Returns null when it is not a supported
 *  table query (missing table/from lines). */
export function parseDataviewQuery(code: string): DataviewQuery | null {
  let columns: DataviewColumn[] = [];
  let from = "";
  let sortField: string | null = null;
  let sortDir: "asc" | "desc" = "asc";

  for (const rawLine of code.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const tableM = /^table\s+(.+)$/i.exec(line);
    if (tableM) {
      columns = parseColumns(tableM[1]);
      continue;
    }
    const fromM = /^from\s+"?([^"\n]+?)"?\s*$/i.exec(line);
    if (fromM) {
      from = fromM[1].trim();
      continue;
    }
    const sortM = /^sort\s+([\w.]+)(?:\s+(asc|desc))?$/i.exec(line);
    if (sortM) {
      sortField = sortM[1].toLowerCase();
      sortDir = (sortM[2]?.toLowerCase() as "asc" | "desc") ?? "asc";
      continue;
    }
  }

  if (columns.length === 0 || !from) return null;
  return { columns, from, sortField, sortDir };
}

/** Split a column list on commas that are OUTSIDE double quotes, then parse
 *  each `field AS "Label"` pair. */
function parseColumns(spec: string): DataviewColumn[] {
  const parts: string[] = [];
  let cur = "";
  let inQuote = false;
  for (const ch of spec) {
    if (ch === '"') inQuote = !inQuote;
    if (ch === "," && !inQuote) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);

  const out: DataviewColumn[] = [];
  for (const part of parts) {
    const m = /^\s*([\w.]+)\s*(?:AS\s+"([^"]*)")?\s*$/i.exec(part);
    if (!m) continue;
    const field = m[1].toLowerCase();
    out.push({ field, label: m[2] || field });
  }
  return out;
}

/** A row returned by the backend: file metadata plus its frontmatter pairs. */
export interface DataviewRowData {
  path: string;
  name: string;
  mtimeSecs: number;
  sizeBytes: number;
  values: [string, string][];
}

/** Resolve a row's value for a field reference. */
export function fieldValue(row: DataviewRowData, field: string): string {
  switch (field) {
    case "file.name":
      return row.name;
    case "file.path":
      return row.path;
    case "file.mtime":
      return formatDateTime(row.mtimeSecs);
    case "file.ctime":
      return formatDateTime(row.mtimeSecs); // backend tracks one timestamp
    case "file.size": {
      const kb = row.sizeBytes / 1024;
      return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(1)} KB`;
    }
    default: {
      const key = field.startsWith("file.") ? field.slice(5) : field;
      const v = row.values.find(([k]) => k.toLowerCase() === key)?.[1] ?? "";
      // YAML nulls render as empty, not the literal word.
      return v === "null" ? "" : v;
    }
  }
}

/** Sort comparator for a field reference (numeric where both sides parse). */
export function compareByField(a: DataviewRowData, b: DataviewRowData, field: string): number {
  if (field === "file.mtime" || field === "file.ctime") {
    return a.mtimeSecs - b.mtimeSecs;
  }
  if (field === "file.size") {
    return a.sizeBytes - b.sizeBytes;
  }
  const av = fieldValue(a, field);
  const bv = fieldValue(b, field);
  const an = Number(av);
  const bn = Number(bv);
  if (!Number.isNaN(an) && !Number.isNaN(bn) && av !== "" && bv !== "") {
    return an - bn;
  }
  return av.localeCompare(bv, "zh");
}

function formatDateTime(secs: number): string {
  const d = new Date(secs * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
