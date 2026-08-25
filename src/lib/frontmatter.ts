/**
 * YAML frontmatter helpers shared by the preview Properties card
 * (widgets.ts) and the Properties edit dialog (PropertiesDialog.tsx).
 */

export interface FrontmatterBlock {
  /** YAML body between the markers ("" for an empty frontmatter). */
  body: string;
  /** Byte range of the whole block in the doc. */
  start: number;
  end: number;
  /** True when a closing `---` line was found. */
  closed: boolean;
}

/** The doc-leading `---...---` frontmatter block, or null.
 *
 *  More tolerant than a strict `^---\r?\n...\r?\n---` regex so the opening
 *  marker is never misrendered as a horizontal rule:
 *  - a UTF-8 BOM and leading blank lines are skipped (some editors/sync tools
 *    inject them; frontmatter should still be recognized);
 *  - an EMPTY frontmatter (`---\n---`) matches (the old regex required at
 *    least one body char between the newline and the closing marker, because
 *    the opening marker's newline was consumed);
 *  - an UNCLOSED block (`---` with no closing line — the mid-edit state) is
 *    returned with `closed: false`, spanning the YAML run up to the first
 *    blank line or end of doc, so it renders as a card instead of a rule. */
export function extractFrontmatter(doc: string): FrontmatterBlock | null {
  let start = 0;
  while (start < doc.length) {
    const ch = doc.charCodeAt(start);
    if (ch === 0xfeff || ch === 0x0a || ch === 0x0d) start++;
    else break;
  }
  // The first non-blank line must be exactly `---` (trailing whitespace ok) —
  // `--- not at start` is text, not a frontmatter opener.
  const lineEnd = doc.indexOf("\n", start);
  const firstLine = lineEnd === -1 ? doc.slice(start) : doc.slice(start, lineEnd).replace(/\r$/, "");
  if (!/^---\s*$/.test(firstLine)) return null;
  const openEnd = lineEnd === -1 ? doc.length : lineEnd + 1;

  // Closing marker: a line that is `---` with optional trailing whitespace.
  // Allow it to start the remaining text (empty body) or follow a newline
  // (non-empty body). Some editors/sync tools persist `--- ` with a trailing
  // space, which the old strict regex refused — sending the marker to the
  // markdown renderer as a horizontal rule.
  const rest = doc.slice(openEnd);
  const closeRe = /(?:^|\r?\n)---[ \t]*(?:\r?\n|$)/;
  const m = closeRe.exec(rest);
  if (m) {
    const end = openEnd + m.index + m[0].length;
    return { body: doc.slice(openEnd, openEnd + m.index), start, end, closed: true };
  }
  // Unclosed: span the YAML run up to the first blank line (or end of doc).
  // Only treat it as frontmatter when the run looks like YAML (`key:` lines) —
  // a leading `---` followed by a paragraph or a blank line is a horizontal
  // rule, and swallowing it would render a whole note as a properties card.
  let end = openEnd;
  while (end < doc.length) {
    if (
      doc[end] === "\n" &&
      (doc[end + 1] === "\n" || (doc[end + 1] === "\r" && doc[end + 2] === "\n"))
    ) {
      break;
    }
    end++;
  }
  const body = doc.slice(openEnd, end);
  const looksYaml = /^\s*[A-Za-z_][\w.-]*\s*:/.test(body);
  if (!looksYaml) return null;
  return { body, start, end, closed: false };
}

/** Parse a YAML frontmatter body into [key, value] pairs (top-level only). */
export function parseFrontmatter(body: string): [string, string][] {
  const props: [string, string][] = [];
  for (const line of body.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue; // skip comment/blank/indented lines
    let key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    // strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) props.push([key, val]);
  }
  return props;
}

/** Quote a scalar when YAML would otherwise mis-parse it. Plain numbers and
 *  booleans stay unquoted so parse->serialize round-trips are lossless. */
function yamlScalar(value: string): string {
  if (value === "") return "";
  const needsQuote =
    /[:#\[\]{}&*!|>'"%@`\n]/.test(value) ||
    /^\s|\s$/.test(value) ||
    /^(true|false|null|yes|no|on|off)$/i.test(value);
  return needsQuote ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/** Serialize properties into a `---...---` YAML block (trailing newline).
 *  Values are trimmed and YAML-escaped as needed. */
export function serializeFrontmatter(props: [string, string][]): string {
  const lines = ["---"];
  for (const [key, value] of props) {
    const k = key.trim();
    if (!k) continue;
    const v = yamlScalar(value.trim());
    lines.push(v === "" ? `${k}:` : `${k}: ${v}`);
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}

/** Offset of the first non-whitespace char in a line, or line.length when blank. */
function leadWhitespace(line: string): number {
  const m = /^\s*/.exec(line);
  return m ? m[0].length : line.length;
}

/**
 * Patch an existing frontmatter body with `props`, preserving structure that
 * `parseFrontmatter` cannot round-trip — multi-line list/object values,
 * comments, and blank lines. Only the top-level `key:` lines are rewritten;
 * every other line passes through verbatim, so opening the Properties dialog
 * (or editing a Base-table cell) no longer silently deletes a block-style
 * `tags:` list.
 *
 * A key that is missing from the body (added) is appended at the end; a key
 * whose value would be empty is removed along with its indented continuation
 * lines (that is how the dialog deletes a row).
 */
function patchFrontmatterBody(body: string, props: [string, string][]): string {
  const wanted = new Map<string, string>();
  for (const [k, v] of props) {
    const key = k.trim();
    if (!key) continue;
    wanted.set(key, v.trim());
  }

  const lines = body.split("\n");
  const seen = new Set<string>();
  const out: string[] = [];
  let skipIndented = 0; // >0 while dropping a deleted key's continuation lines

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = leadWhitespace(line);
    if (indent > 0) {
      if (skipIndented > 0) {
        skipIndented--;
        continue;
      }
      // Indented continuation belongs to the previous top-level key; the key's
      // line already wrote it out (or it passed through untouched above).
      out.push(line);
      continue;
    }
    skipIndented = 0;
    const idx = line.indexOf(":");
    if (idx <= 0) {
      // Comment / blank / unparseable top-level line: keep as-is.
      out.push(line);
      continue;
    }
    const key = line.slice(0, idx).trim();
    if (!key || seen.has(key)) {
      // Unknown key or duplicate — preserve the original line.
      out.push(line);
      continue;
    }
    seen.add(key);
    if (!wanted.has(key)) {
      // Deleted key (the row was removed from the dialog): drop it AND its
      // indented continuation lines (list items / nested keys).
      skipIndented = countContinuation(lines, i);
      continue;
    }
    const val = wanted.get(key)!;
    const currentVal = line.slice(idx + 1).trim();
    if (currentVal === "" && hasContinuation(lines, i)) {
      // The key holds a multiline structure that parseFrontmatter flattens
      // to "" — an untouched block. Preserve it verbatim so a no-op Properties
      // save (or a Base-cell edit elsewhere) can't delete the list.
      out.push(line);
      continue;
    }
    if (val === currentVal || (val === "" && currentVal !== "")) {
      // Unchanged value (or the dialog cleared it but the body holds a value):
      // keep the original line so formatting survives.
      out.push(line);
      continue;
    }
    out.push(`${key}: ${yamlScalar(val)}`);
  }

  // Append any added keys (present in props but not in the body).
  for (const [key, val] of wanted) {
    if (!seen.has(key) && val !== "") {
      out.push(`${key}: ${yamlScalar(val)}`);
    }
  }
  return out.join("\n");
}

/** True when the line after index `i` is indented (a multiline value follows). */
function hasContinuation(lines: string[], i: number): boolean {
  return i + 1 < lines.length && leadWhitespace(lines[i + 1]) > 0;
}

/** Number of immediately-following indented lines after index `i`. */
function countContinuation(lines: string[], i: number): number {
  let n = 0;
  for (let j = i + 1; j < lines.length; j++) {
    if (leadWhitespace(lines[j]) > 0) n++;
    else break;
  }
  return n;
}

/** Return the document with `props` written as its frontmatter: replaces an
 *  existing leading block, or inserts one at the top. Preserves multiline
 *  frontmatter structure (see patchFrontmatterBody). */
export function replaceFrontmatter(doc: string, props: [string, string][]): string {
  const fm = extractFrontmatter(doc);
  if (!fm) return serializeFrontmatter(props) + doc;
  const body = patchFrontmatterBody(fm.body, props);
  const block = body.trim() ? `---\n${body}\n---\n` : `---\n---\n`;
  return block + doc.slice(fm.end);
}
