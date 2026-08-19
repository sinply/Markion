/**
 * YAML frontmatter helpers shared by the preview Properties card
 * (widgets.ts) and the Properties edit dialog (PropertiesDialog.tsx).
 */

/** The doc-leading `---...---` block: its body and its source range, or null. */
export function extractFrontmatter(doc: string): { body: string; start: number; end: number } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(doc);
  if (!m) return null;
  return { body: m[1], start: 0, end: m[0].length };
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

/** Serialize properties into a `---...---` YAML block (trailing newline). */
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

/** Return the document with `props` written as its frontmatter: replaces an
 *  existing leading block, or inserts one at the top. */
export function replaceFrontmatter(doc: string, props: [string, string][]): string {
  const block = serializeFrontmatter(props);
  const fm = extractFrontmatter(doc);
  return fm ? block + doc.slice(fm.end) : block + doc;
}
