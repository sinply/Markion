import MarkdownIt from "markdown-it";
import { common, createLowlight } from "lowlight";

const lowlight = createLowlight(common);

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

/** Syntax-highlight a code block using lowlight. */
export function highlightCode(code: string, lang: string): string {
  if (lang && lowlight.registered(lang)) {
    try {
      const root = lowlight.highlight(lang, code);
      return hastToHtml(root);
    } catch {
      // ignore highlight errors
    }
  }
  return escapeHtml(code);
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
