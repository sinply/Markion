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

function hastToHtml(node: any): string {
  if (node.type === "text") return escapeHtml(node.value ?? "");
  if (node.type === "element") {
    const tag = node.tagName ?? "span";
    const props = node.properties ?? {};
    const attrStr = Object.entries(props)
      .map(([k, v]) => ` ${k}="${String(v)}"`)
      .join("");
    const children = (node.children ?? []).map(hastToHtml).join("");
    return `<${tag}${attrStr}>${children}</${tag}>`;
  }
  if (node.type === "root") {
    return (node.children ?? []).map(hastToHtml).join("");
  }
  return "";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
