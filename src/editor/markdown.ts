import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: true });
md.enable(["table", "strikethrough"]);

/** Render full markdown to HTML. Used by block widgets. */
export function renderMarkdown(src: string): string {
  return md.render(src);
}

/** Render inline markdown only (no block wrappers). */
export function renderMarkdownInline(src: string): string {
  return md.renderInline(src);
}

/** Render markdown to HTML, injecting each table cell's raw inline source as a
 *  `data-source` attribute. The token stream preserves cell source (e.g. `*em*`)
 *  that the rendered HTML drops, so table edit-in-place can preserve formats.
 *
 *  Note: the th/td render rules are temporarily overridden on the shared `md`
 *  instance and restored afterwards, so `renderMarkdown` (used by the full-doc
 *  preview) is not permanently polluted with the data-source injection. */
export function renderMarkdownWithTableSource(src: string): string {
  const thDefault = md.renderer.rules.th_open;
  const tdDefault = md.renderer.rules.td_open;
  md.renderer.rules.th_open = (tokens: any, idx: number, options: any, env: any, self: any) => {
    const token = tokens[idx];
    const next = tokens[idx + 1];
    if (next && next.type === "inline") token.attrSet("data-source", next.content);
    return self.renderToken(tokens, idx, options);
  };
  md.renderer.rules.td_open = (tokens: any, idx: number, options: any, env: any, self: any) => {
    const token = tokens[idx];
    const next = tokens[idx + 1];
    if (next && next.type === "inline") token.attrSet("data-source", next.content);
    return self.renderToken(tokens, idx, options);
  };
  try {
    return md.render(src);
  } finally {
    md.renderer.rules.th_open = thDefault;
    md.renderer.rules.td_open = tdDefault;
  }
}

/** Serialize a HAST (lowlight v3) node to HTML.
 *  Handles lowlight's className arrays (output as class="a b") and
 *  escapes attribute values. */
function hastToHtml(node: any): string {
  if (node.type === "text") return escapeHtml(node.value ?? "");
  if (node.type === "element") {
    const tag = node.tagName ?? "span";
    const props = node.properties ?? {};
    const parts: string[] = [];
    for (const [k, v] of Object.entries(props)) {
      const attr = k === "className" ? "class" : k;
      const val = Array.isArray(v) ? v.join(" ") : String(v);
      parts.push(` ${attr}="${escapeAttr(val)}"`);
    }
    const children = (node.children ?? []).map(hastToHtml).join("");
    return `<${tag}${parts.join("")}>${children}</${tag}>`;
  }
  if (node.type === "root") {
    return (node.children ?? []).map(hastToHtml).join("");
  }
  return "";
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
