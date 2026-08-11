import { WidgetType } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { renderMarkdown } from "./markdown";
import { markdownContextFacet, imageToSrc, isRemoteSrc } from "./media";

export class CodeBlockWidget extends WidgetType {
  readonly language: string;
  view: EditorView | null = null;
  blockFrom = 0;
  blockTo = 0;

  constructor(
    readonly code: string,
    lang: string,
  ) {
    super();
    this.language = lang.toLowerCase();
  }

  eq(other: CodeBlockWidget): boolean {
    return other.code === this.code && other.language === this.language;
  }

  toDOM(view: EditorView): HTMLElement {
    // Mermaid diagrams: render as SVG instead of code
    if (this.language === "mermaid") {
      return renderMermaid(this.code);
    }
    this.view = view;
    const pre = document.createElement("pre");
    pre.className = "cm-codeblock";

    if (this.language) {
      const tag = document.createElement("div");
      tag.className = "cm-codeblock-lang";
      tag.textContent = this.language;
      pre.appendChild(tag);
    }

    const code = document.createElement("code");
    code.className = "cm-codeblock-editable";
    // setAttribute rather than `code.contentEditable = "true"`: jsdom doesn't
    // reflect the property to the `contenteditable` attribute, and the app CSS
    // selects on `[contenteditable]` (test relies on the attribute too).
    code.setAttribute("contenteditable", "true");
    code.textContent = this.code;
    pre.appendChild(code);
    return pre;
  }

  // Ignore mousedown so CM6 does not move its cursor into the block (which
  // would trigger the isOnActiveLine source flip). The contenteditable handles
  // the click itself and takes focus.
  ignoreEvent(e: Event): boolean {
    return e.type === "mousedown" || e.type === "mouseup" || e.type === "click";
  }
}

/** Render a Mermaid diagram into a container. Lazy-loads mermaid. */
function renderMermaid(code: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "cm-mermaid";
  wrap.textContent = code; // fallback shown until mermaid loads
  void (async () => {
    try {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({ startOnLoad: false, theme: "default" });
      const { svg } = await mermaid.render("m" + Math.random().toString(36).slice(2), code);
      wrap.innerHTML = svg;
    } catch (e) {
      wrap.className = "cm-mermaid cm-mermaid-error";
      wrap.textContent = `[Mermaid error: ${String(e)}]\n\n${code}`;
    }
  })();
  return wrap;
}

/** Render inline math ($...$) via KaTeX. Lazy-loads katex. */
export class MathInlineWidget extends WidgetType {
  constructor(readonly tex: string) {
    super();
  }

  eq(other: MathInlineWidget): boolean {
    return other.tex === this.tex;
  }

  toDOM(_view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-math-inline";
    span.textContent = `$${this.tex}$`; // fallback until katex loads
    void (async () => {
      try {
        const katex = (await import("katex")).default;
        span.innerHTML = katex.renderToString(this.tex, {
          displayMode: false,
          throwOnError: false,
        });
      } catch {
        // keep fallback
      }
    })();
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Render a block-math ($$...$$) via KaTeX. Lazy-loads katex. */
export class MathBlockWidget extends WidgetType {
  constructor(readonly tex: string) {
    super();
  }

  eq(other: MathBlockWidget): boolean {
    return other.tex === this.tex;
  }

  toDOM(_view: EditorView): HTMLElement {
    const div = document.createElement("div");
    div.className = "cm-math-block";
    div.textContent = `$$${this.tex}$$`; // fallback until katex loads
    void (async () => {
      try {
        const katex = (await import("katex")).default;
        div.innerHTML = katex.renderToString(this.tex, {
          displayMode: true,
          throwOnError: false,
        });
      } catch {
        // keep the raw fallback text
      }
    })();
    return div;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Read-only full-document preview: renders the whole markdown to HTML. */
export class PreviewWidget extends WidgetType {
  constructor(readonly raw: string) {
    super();
  }

  eq(other: PreviewWidget): boolean {
    return other.raw === this.raw;
  }

  toDOM(view: EditorView): HTMLElement {
    const div = document.createElement("div");
    div.className = "cm-preview";
    // Split off the doc-leading YAML frontmatter so markdown-it doesn't render
    // it as a broken heading/hr; show it as a properties card instead.
    const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(this.raw);
    const body = fm ? this.raw.slice(fm[0].length) : this.raw;
    if (fm) {
      const props = parseFrontmatter(fm[1]);
      if (props.length > 0) {
        const card = new FrontmatterWidget(props).toDOM(view);
        card.classList.add("cm-preview-frontmatter");
        div.appendChild(card);
      }
    }
    const bodyEl = document.createElement("div");
    bodyEl.className = "cm-preview-body";
    bodyEl.innerHTML = renderMarkdown(body);
    // Resolve local image srcs (rewrite relative paths via the context facet).
    const ctx = view.state.facet(markdownContextFacet)[0];
    if (ctx) {
      bodyEl.querySelectorAll("img").forEach((img) => {
        const src = img.getAttribute("src") ?? "";
        if (src && !isRemoteSrc(src)) {
          img.src = imageToSrc(src, ctx);
        }
      });
    }
    div.appendChild(bodyEl);
    return div;
  }

  ignoreEvent(): boolean {
    return false;
  }
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

/** Map a frontmatter key to an Obsidian-style property icon. */
function propertyIcon(key: string): string {
  const k = key.toLowerCase();
  if (k.includes("author") || k.includes("creator")) return "✏️";
  if (k.includes("date") || k.includes("created") || k.includes("updated")) return "\u{1F4C5}";
  if (k.includes("class") || k.includes("category") || k.includes("type")) return "\u{1F4C1}";
  if (k.includes("tag")) return "\u{1F3F7}️";
  if (k.includes("url") || k.includes("link")) return "\u{1F517}";
  if (k.includes("version")) return "\u{1F4C8}";
  if (k.includes("status")) return "\u{1F4CC}";
  return "\u{1F4CB}"; // clipboard
}

/** Obsidian-style Properties panel for YAML frontmatter. */
export class FrontmatterWidget extends WidgetType {
  constructor(readonly props: [string, string][]) {
    super();
  }

  eq(other: FrontmatterWidget): boolean {
    return JSON.stringify(other.props) === JSON.stringify(this.props);
  }

  toDOM(_view: EditorView): HTMLElement {
    const card = document.createElement("div");
    card.className = "cm-frontmatter";
    for (const [key, value] of this.props) {
      const row = document.createElement("div");
      row.className = "cm-frontmatter-row";

      const icon = document.createElement("span");
      icon.className = "cm-frontmatter-icon";
      icon.textContent = propertyIcon(key);
      row.appendChild(icon);

      const keyEl = document.createElement("span");
      keyEl.className = "cm-frontmatter-key";
      keyEl.textContent = key;
      row.appendChild(keyEl);

      if (value !== "") {
        const valEl = document.createElement("span");
        valEl.className = "cm-frontmatter-value";
        valEl.textContent = value;
        row.appendChild(valEl);
      }

      card.appendChild(row);
    }
    return card;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export class TableWidget extends WidgetType {
  constructor(readonly raw: string) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.raw === this.raw;
  }

  toDOM(_view: EditorView): HTMLElement {
    const div = document.createElement("div");
    div.className = "cm-table";
    div.innerHTML = renderMarkdown(this.raw);
    return div;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export class TaskCheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked;
  }

  toDOM(_view: EditorView): HTMLElement {
    const label = document.createElement("label");
    label.className = "cm-task-toggle";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.disabled = true; // clicks handled by CM6 event handler
    label.appendChild(input);
    return label;
  }

  ignoreEvent(e: Event): boolean {
    return e.type === "mousedown" || e.type === "mouseup" || e.type === "click";
  }
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-image-wrap";

    const img = document.createElement("img");
    img.className = "cm-image";
    img.alt = this.alt;
    // Some CDNs (e.g. Aliyun OSS / nlark) enable hotlink protection and reject
    // requests carrying a Referer. Strip it so remote images load.
    img.referrerPolicy = "no-referrer";
    const ctx = view.state.facet(markdownContextFacet)[0];
    img.src = imageToSrc(this.src, ctx);

    img.addEventListener("error", () => {
      wrap.classList.add("cm-image-broken");
      const placeholder = document.createElement("span");
      placeholder.className = "cm-image-placeholder";
      placeholder.textContent = `[图片: ${this.src}]`;
      placeholder.title = "图片加载失败：文件不存在或路径错误";
      wrap.replaceChild(placeholder, img);
    });

    wrap.appendChild(img);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
