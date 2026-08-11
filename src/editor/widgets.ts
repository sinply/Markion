import { WidgetType } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { renderMarkdown, renderMarkdownWithTableSource } from "./markdown";
import { markdownContextFacet, imageToSrc, isRemoteSrc } from "./media";

export class CodeBlockWidget extends WidgetType {
  readonly language: string;
  view: EditorView | null = null;
  blockFrom = -1;
  blockTo = -1;

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
    // reflect the property to the `contenteditable` attribute, and the test
    // selects on `[contenteditable]`.
    code.setAttribute("contenteditable", "true");
    code.textContent = this.code;
    pre.appendChild(code);

    // Commit the edited code back to the document when the user leaves the block.
    code.addEventListener("blur", () => {
      if (!this.view || this.blockFrom < 0 || this.blockTo < 0) return;
      const newCode = code.textContent ?? "";
      const lang = this.language;
      const newSource = "```" + lang + "\n" + newCode + "\n```";
      if (newSource !== this.code) {
        this.view.dispatch({
          changes: { from: this.blockFrom, to: this.blockTo, insert: newSource },
        });
      }
    });
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

/** Small persistent "source" badge that flips this block to raw source when
 *  clicked. `from`/`to` are the block's range in the document; stored as
 *  data attributes so the click handler (livePreview.ts) can flip the block
 *  to source without re-resolving the syntax tree (math blocks have no Lezer
 *  node). Returns the badge element so callers can re-attach it after a later
 *  `innerHTML` replacement (katex rendering) would have wiped it out. */
function appendSourceBadge(container: HTMLElement, from: number, to: number): HTMLElement {
  const badge = document.createElement("span");
  badge.className = "cm-source-badge";
  badge.dataset.from = String(from);
  badge.dataset.to = String(to);
  badge.textContent = "source";
  badge.title = "Edit source";
  container.appendChild(badge);
  return badge;
}

/** Render inline math ($...$) via KaTeX. Lazy-loads katex. */
export class MathInlineWidget extends WidgetType {
  from = 0;
  to = 0;

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
    const badge = appendSourceBadge(span, this.from, this.to);
    void (async () => {
      try {
        const katex = (await import("katex")).default;
        span.innerHTML = katex.renderToString(this.tex, {
          displayMode: false,
          throwOnError: false,
        });
        // innerHTML replaced all children — re-attach the badge.
        span.appendChild(badge);
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
  from = 0;
  to = 0;

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
    const badge = appendSourceBadge(div, this.from, this.to);
    void (async () => {
      try {
        const katex = (await import("katex")).default;
        div.innerHTML = katex.renderToString(this.tex, {
          displayMode: true,
          throwOnError: false,
        });
        // innerHTML replaced all children — re-attach the badge.
        div.appendChild(badge);
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
  view: EditorView | null = null;
  blockFrom = -1;
  blockTo = -1;

  constructor(readonly raw: string) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.raw === this.raw;
  }

  toDOM(view: EditorView): HTMLElement {
    this.view = view;
    const div = document.createElement("div");
    div.className = "cm-table";
    div.innerHTML = renderMarkdownWithTableSource(this.raw);
    // Make each cell editable; edits are committed to the CM6 doc on blur.
    // Cells the user actually edits are marked data-edited so serialization
    // preserves the raw source of untouched cells verbatim (links, bold,
    // entities etc. survive a no-op blur instead of being stripped).
    div.querySelectorAll("td, th").forEach((cell) => {
      cell.setAttribute("contenteditable", "true");
      cell.addEventListener("input", () => {
        cell.setAttribute("data-edited", "true");
      });
    });
    div.addEventListener(
      "blur",
      () => {
        if (!this.view || this.blockFrom < 0 || this.blockTo < 0) return;
        const newSource = serializeTableCells(div);
        if (newSource && newSource !== this.raw) {
          this.view.dispatch({
            changes: { from: this.blockFrom, to: this.blockTo, insert: newSource },
          });
        }
      },
      true,
    );
    return div;
  }

  ignoreEvent(e: Event): boolean {
    return e.type === "mousedown" || e.type === "mouseup" || e.type === "click";
  }
}

/** Serialize the editable table DOM back into GFM pipe syntax. Each cell's
 *  `data-source` holds its raw inline source; if a cell's text is unchanged we
 *  write the source verbatim (preserving escaped pipes / format markers). */
export function serializeTableCells(tableEl: HTMLElement): string {
  const rows: HTMLElement[][] = [];
  tableEl.querySelectorAll("tr").forEach((tr) => {
    rows.push(Array.from(tr.querySelectorAll("th, td")) as HTMLElement[]);
  });
  if (rows.length === 0) return "";
  const header = rows[0].map(cellText);
  const body = rows.slice(1).map((r) => r.map(cellText));
  const align = detectAlign(tableEl);
  return [pipeRow(header), alignRow(align), ...body.map((r) => pipeRow(r))].join("\n");
}

function cellText(cell: HTMLElement): string {
  const src = cell.getAttribute("data-source") ?? "";
  if (cell.getAttribute("data-edited") !== "true") {
    // Unedited cell — write the raw inline source verbatim so links, bold,
    // entities, code spans etc. survive (their rendered textContent differs
    // from data-source, so the comparison-based approach destroyed them on a
    // no-op blur). data-source holds the parser-unescaped source, so re-escape
    // literal pipes to keep the row parseable as a GFM table.
    return src.replace(/\|/g, "\\|");
  }
  // The cell was edited — re-serialize, preserving a simple format wrap.
  const text = (cell.textContent ?? "").trim();
  return preserveWrap(src, text);
}

/** If data-source was a simple marker wrap (*x*, `x`, **x**) and only the inner
 *  text changed, re-wrap. Otherwise return plain text, re-escaping literal
 *  pipes so the row still parses as a GFM table when written back. */
function preserveWrap(src: string, newText: string): string {
  if (newText === "") return ""; // cleared cell — emit nothing, not a stray `**`
  const m = /^(\*{1,2}|`|_{1,2}|~~)([\s\S]*?)\1$/.exec(src);
  if (m) {
    // The markdown parser already unescaped pipes in data-source (`*a\|b*`
    // arrives here as `*a|b*`), so re-escape literal pipes on write-back. The
    // GFM table rule splits cells on `|` even inside `*...*` markers, so an
    // unescaped pipe would re-parse the row into extra columns and destroy the
    // emphasis wrap. Keep the wrap (or re-wrap the edited inner text).
    const wrapped = m[2] === newText ? src : m[1] + newText + m[1];
    return wrapped.replace(/\|/g, "\\|");
  }
  const out = src === newText ? src : newText;
  // The markdown parser already unescaped pipes in data-source (`a\|b` arrives
  // here as `a|b`), so re-escape literal pipes to keep the cell parseable.
  return out.replace(/\|/g, "\\|");
}

function pipeRow(cells: string[]): string {
  return "| " + cells.join(" | ") + " |";
}

function detectAlign(tableEl: HTMLElement): string[] {
  const firstRow = tableEl.querySelector("tr");
  if (!firstRow) return [];
  return Array.from(firstRow.querySelectorAll("th, td")).map((cell) => {
    const style = (cell as HTMLElement).style.textAlign;
    if (style === "right") return "---:";
    if (style === "center") return ":---:";
    return "---";
  });
}

function alignRow(align: string[]): string {
  return "| " + align.join(" | ") + " |";
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
  from = 0;
  to = 0;

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
    appendSourceBadge(wrap, this.from, this.to);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
