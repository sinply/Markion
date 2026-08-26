import { WidgetType } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { renderMarkdown, renderMarkdownWithTableSource, highlightCode, isMermaidLang } from "./markdown";
import { markdownContextFacet, imageToSrc, isRemoteSrc } from "./media";
import { wikiLabel } from "./wikiIndex";
import { extractFrontmatter, parseFrontmatter } from "../lib/frontmatter";
import { parseDataviewQuery, fieldValue, compareByField } from "./dataview";
import { getEditorView } from "./registry";

// ---- Dynamic position resolution ----
//
// Every interactive widget uses CONTENT-ONLY eq(). When eq() matches across
// transactions, CM6 keeps the existing widget DOM (and its event handlers,
// which close over the ORIGINAL widget instance) instead of rebuilding it.
// Handlers therefore MUST NOT read construction-time position fields — they
// resolve every document position at EVENT time: map the widget's DOM node
// back into the document with view.posAtDOM(), then recover the exact range
// from the syntax tree around that hint. This kills both bug classes at once:
// stale-position jumps (handler using an offset from before an edit shifted
// the block) and per-keystroke DOM churn (position-sensitive eq forcing a
// full rebuild — and a full mermaid.render/markdown-it pass — whenever any
// keystroke elsewhere moved the block).

/** Current document-position hints for an element inside a live widget.
 *  CM6 maps a DOM node inside a widget to the boundary of the widget's
 *  decoration range; probing with and without a child offset covers either
 *  boundary. Returns [] when the element isn't attached to `view` (destroyed
 *  widget, or a bare mock view in unit tests). */
function domPositionHints(view: EditorView, el: HTMLElement): number[] {
  const hints: number[] = [];
  try {
    for (const offset of [0, el.childNodes.length]) {
      const pos = view.posAtDOM(el, offset);
      if (Number.isFinite(pos) && pos >= 0 && !hints.includes(pos)) hints.push(pos);
    }
  } catch {
    // Not part of this view's content — no live position available.
  }
  return hints;
}

/** Innermost node of one of `types` around `hint`, resolved against the fully
 *  expanded syntax tree; returns that node's exact [from, to]. Both boundary
 *  biases are probed because the hint may sit on either side of the widget. */
function nodeRangeAround(
  state: EditorState,
  hint: number,
  types: string[],
): { from: number; to: number } | null {
  const at = Math.max(0, Math.min(hint, state.doc.length));
  try {
    const tree = ensureSyntaxTree(state, state.doc.length, 500) ?? syntaxTree(state);
    for (const side of [-1, 1] as const) {
      let node: SyntaxNode | null = tree.resolveInner(at, side);
      while (node) {
        if (types.includes(node.type.name)) return { from: node.from, to: node.to };
        node = node.parent;
      }
    }
  } catch {
    // No parser available (bare EditorState in unit tests) — fall through.
  }
  return null;
}

/** Fallback for fenced blocks when the tree can't confirm the node: scan up
 *  from `hint` to the opening ``` fence carrying `lang`, then down to the
 *  closing fence (or EOF for an unclosed fence). Fenced blocks only. */
function fencedRangeByScan(
  state: EditorState,
  hint: number,
  lang: string,
): { from: number; to: number } | null {
  if (!lang || hint < 0) return null;
  const doc = state.doc;
  let open = doc.lineAt(Math.min(hint, doc.length));
  while (!open.text.trimStart().startsWith("```")) {
    if (open.number === 1) return null;
    open = doc.line(open.number - 1);
  }
  const info = open.text.trim().replace(/^`{3,}/, "").trim().toLowerCase();
  if (info.split(/\s+/)[0] !== lang) return null;
  let close = open;
  while (close.number < doc.lines) {
    const nextLine = doc.line(close.number + 1);
    close = nextLine;
    if (/^`{3,}\s*$/.test(nextLine.text.trim())) break;
  }
  return { from: open.from, to: close.to };
}

/** Fallback table locate when no Lezer Table node confirms the range: expand
 *  from `hint`'s line across contiguous pipe-table lines (leading `|`, or an
 *  alignment row of dashes/pipes). */
function tableRangeByScan(state: EditorState, hint: number): { from: number; to: number } | null {
  if (hint < 0) return null;
  const doc = state.doc;
  const isTableLine = (t: string) =>
    /^\s*\|/.test(t) || /^\s*:?-{3,}(\s*\|)+/.test(t);
  let first = doc.lineAt(Math.min(hint, doc.length));
  // The hint must sit on a line that looks like a table row before expanding.
  if (!isTableLine(first.text)) return null;
  while (first.number > 1 && isTableLine(doc.line(first.number - 1).text)) {
    first = doc.line(first.number - 1);
  }
  let last = first;
  while (last.number < doc.lines && isTableLine(doc.line(last.number + 1).text)) {
    last = doc.line(last.number + 1);
  }
  return { from: first.from, to: last.to };
}

/** Fallback TaskMarker locate: the nearest `` `[ ]` ``/`` `[x]` `` token on the
 *  hint's line (used when no Lezer TaskMarker node is available). */
function markerRangeByScan(
  state: EditorState,
  hint: number,
): { from: number; to: number } | null {
  if (hint < 0) return null;
  const line = state.doc.lineAt(Math.min(hint, state.doc.length));
  const re = /\[[xX ]\]/g;
  let best: { from: number; to: number } | null = null;
  let bestDist = Infinity;
  for (let m = re.exec(line.text); m; m = re.exec(line.text)) {
    const from = line.from + m.index;
    const to = from + m[0].length;
    const dist = hint >= from && hint <= to ? -1 : Math.min(Math.abs(hint - from), Math.abs(hint - to));
    if (dist < bestDist) {
      bestDist = dist;
      best = { from, to };
    }
  }
  return best;
}

export class CodeBlockWidget extends WidgetType {
  readonly language: string;
  view: EditorView | null = null;

  constructor(
    readonly code: string,
    lang: string,
  ) {
    super();
    this.language = lang.toLowerCase();
  }

  // Content-ONLY equality. The commit-on-blur handler resolves the block's
  // range dynamically (see currentBlockRange), so a reused DOM can never
  // commit at a stale offset — and position-sensitive eq would defeat the
  // reuse entirely, rebuilding (and re-highlighting / re-running mermaid for
  // diagram fences) on every keystroke typed anywhere else in the document.
  eq(other: CodeBlockWidget): boolean {
    return other.code === this.code && other.language === this.language;
  }

  /** Live [from, to] of this widget's block in the CURRENT document, derived
   *  from where its DOM sits right now — never from stored offsets. */
  private currentBlockRange(
    view: EditorView,
    root: HTMLElement,
  ): { from: number; to: number } | null {
    const hints = domPositionHints(view, root);
    for (const hint of hints) {
      const r = nodeRangeAround(view.state, hint, ["FencedCode", "CodeBlock"]);
      if (r && r.to > r.from) return r;
    }
    return hints.length > 0 ? fencedRangeByScan(view.state, hints[0], this.language) : null;
  }

  toDOM(view: EditorView): HTMLElement {
    // Mermaid diagrams (```mermaid, ```gantt, ```sequenceDiagram, ...):
    // render as SVG instead of code.
    if (isMermaidLang(this.language)) {
      return renderMermaidElement(this.code);
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

    // Copy button (top-right corner of the block).
    const copyBtn = document.createElement("button");
    copyBtn.className = "cm-codeblock-copy";
    copyBtn.textContent = "⧉";
    copyBtn.title = "Copy code";
    copyBtn.addEventListener("click", () => {
      void navigator.clipboard?.writeText(this.code).catch(() => {});
    });
    pre.appendChild(copyBtn);

    const code = document.createElement("code");
    code.className = "cm-codeblock-editable";
    // setAttribute rather than `code.contentEditable = "true"`: jsdom doesn't
    // reflect the property to the `contenteditable` attribute, and the test
    // selects on `[contenteditable]`.
    code.setAttribute("contenteditable", "true");
    // Syntax-highlight by fence language (hljs spans). Edits inside the
    // contenteditable are committed via textContent, so highlighting is a pure
    // presentation layer rebuilt on each widget refresh.
    code.innerHTML = highlightCode(this.code, this.language);

    // Line numbers alongside the code. Wrapped with the code in a flex row so
    // the gutter stays glued to the code column even when long lines make the
    // block scroll horizontally (the old float layout drifted/vanished).
    const lineCount = this.code.split("\n").length;
    const body = document.createElement("div");
    body.className = "cm-codeblock-body";

    const lines = document.createElement("div");
    lines.className = "cm-codeblock-lines";
    lines.setAttribute("aria-hidden", "true");
    lines.textContent = Array.from({ length: lineCount }, (_, i) => String(i + 1)).join("\n");

    body.appendChild(lines);
    body.appendChild(code);
    pre.appendChild(body);

    // Commit the edited code back to the document when the user leaves the block.
    code.addEventListener("blur", () => {
      const newCode = code.textContent ?? "";
      // Compare unfenced to unfenced: `newCode` is the code body, `this.code`
      // the constructor arg (unfenced). `newSource` is the fenced rebuild and
      // can never equal `this.code` — comparing them would make every blur
      // (even no-op ones) dispatch a transaction and append a phantom undo step.
      if (newCode === this.code) return;
      const liveView = this.view ?? getEditorView();
      if (!liveView) return;
      const range = this.currentBlockRange(liveView, pre);
      if (!range) return;
      const newSource = "```" + this.language + "\n" + newCode + "\n```";
      liveView.dispatch({
        changes: { from: range.from, to: range.to, insert: newSource },
      });
    });
    return pre;
  }

  // Mermaid diagrams are NOT contenteditable: let CM6 handle mouse events so
  // clicking a diagram moves the cursor onto the block, which flips live
  // preview back to the editable source. Code blocks own a contenteditable,
  // so CM6 must ignore ALL events inside them (see commit-on-blur above),
  // otherwise key/input events fall through to the doc-end cursor.
  ignoreEvent(e: Event): boolean {
    if (isMermaidLang(this.language)) return false;
    return true;
  }
}

/** Render a Mermaid diagram into a container. Lazy-loads mermaid. Shared by
 *  the live-preview CodeBlockWidget and the full-document PreviewWidget so
 *  both editor modes render diagrams identically. */
export function renderMermaidElement(code: string): HTMLElement {
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

/** Locate the first `pattern` match within ±`windowLines` of the hint's line;
 *  used by resolveBadgeRange for tokens without a Lezer node. */
function patternNearLine(
  doc: EditorState["doc"],
  hint: number,
  pattern: RegExp,
  windowLines = 3,
): { from: number; to: number } | null {
  const anchor = doc.lineAt(Math.min(hint, doc.length));
  let best: { from: number; to: number } | null = null;
  let bestDist = Infinity;
  for (let d = 0; d <= windowLines; d++) {
    for (const dir of d === 0 ? [0] : [-d, d]) {
      const n = anchor.number + dir;
      if (n < 1 || n > doc.lines) continue;
      const line = doc.line(n);
      const m = pattern.exec(line.text);
      if (m) {
        const dist = Math.abs(dir);
        if (dist < bestDist) {
          bestDist = dist;
          best = { from: line.from + m.index, to: line.from + m.index + m[0].length };
        }
      }
    }
  }
  return best;
}

/** Live document range for a math/image widget's "source" badge click.
 *  Content-only eq lets CM6 reuse the widget DOM after edits ABOVE it moved
 *  the block — so the construction-time offsets baked into the badge's data
 *  attributes are stale exactly when it matters (the click jumps to the wrong
 *  place). This maps the widget's DOM back into the CURRENT document instead:
 *  `$$…$$`, `$…$`, or `![…](…)` literal token near the live position wins;
 *  the stored attributes remain as last-resort fallback. */
export function resolveBadgeRange(
  view: EditorView,
  badge: HTMLElement,
): { from: number; to: number } | null {
  const root = badge.closest<HTMLElement>(".cm-math-block, .cm-math-inline, .cm-image-wrap");
  const fallbackFrom = Number(badge.dataset.from);
  const fallbackTo = Number(badge.dataset.to);
  const fallback =
    Number.isFinite(fallbackFrom) && Number.isFinite(fallbackTo)
      ? { from: fallbackFrom, to: fallbackTo }
      : null;
  if (!root) return fallback;
  const hints = domPositionHints(view, root);
  if (hints.length === 0) return fallback;
  const state = view.state;
  const hint = Math.min(hints[0], state.doc.length);
  let range: { from: number; to: number } | null = null;
  if (root.classList.contains("cm-image-wrap")) {
    range = patternNearLine(state.doc, hint, /!\[[^\]\n]*\]\([^)\n]*\)/);
  } else if (root.classList.contains("cm-math-block")) {
    range = patternNearLine(state.doc, hint, /^\s*\$\$/m, 8);
    if (range) {
      // Expand to the whole $$ … $$ block: opening line down to the line
      // whose text ends with $$ (or EOF for an unterminated block).
      const openLine = state.doc.lineAt(range.from);
      let closeLine = openLine;
      while (closeLine.number < state.doc.lines) {
        const next = state.doc.line(closeLine.number + 1);
        closeLine = next;
        if (next.text.trim().endsWith("$$")) break;
      }
      range = { from: openLine.from, to: closeLine.to };
    }
  } else {
    range = patternNearLine(state.doc, hint, /\$[^$\n]+\$/);
  }
  return range ?? fallback;
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
    // it as a broken heading/hr; show it as a properties card instead. Use the
    // shared extractFrontmatter so this matches live preview + the Properties
    // dialog (empty blocks, BOM, leading blank lines included).
    const fm = extractFrontmatter(this.raw);
    const body = fm ? this.raw.slice(fm.end) : this.raw;
    if (fm) {
      const props = parseFrontmatter(fm.body);
      if (props.length > 0) {
        const card = new FrontmatterWidget(props).toDOM(view);
        card.classList.add("cm-preview-frontmatter");
        div.appendChild(card);
      }
    }
    const bodyEl = document.createElement("div");
    bodyEl.className = "cm-preview-body";
    bodyEl.innerHTML = renderMarkdown(body);
    // Hydrate mermaid fences (markdown-it emits a pending container) so
    // preview mode shows diagrams exactly like live-preview mode.
    bodyEl.querySelectorAll<HTMLElement>(".cm-mermaid-pending").forEach((el) => {
      const code = el.textContent ?? "";
      el.replaceWith(renderMermaidElement(code));
    });
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
    // Preview mode mirrors the editor's conveniences: click an image to zoom,
    // and every code block gets a copy button.
    bodyEl.querySelectorAll("img").forEach((img) => {
      img.addEventListener("click", () => openLightbox(img.currentSrc || img.src));
    });
    bodyEl.querySelectorAll("pre").forEach((pre) => {
      const btn = document.createElement("button");
      btn.className = "cm-codeblock-copy";
      btn.textContent = "⧉";
      btn.title = "Copy code";
      btn.addEventListener("click", () => {
        void navigator.clipboard?.writeText(pre.textContent ?? "").catch(() => {});
      });
      pre.appendChild(btn);
    });
    div.appendChild(bodyEl);
    return div;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Parse a YAML frontmatter body into [key, value] pairs (top-level only).
 *  Lives in ../lib/frontmatter.ts (shared with the Properties dialog). */
export { parseFrontmatter } from "../lib/frontmatter";

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

      if (value !== "" && value.toLowerCase() !== "null") {
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

interface ParsedTable {
  header: string[];
  align: string[];
  rows: string[][];
}

/** Parse GFM table source into header / align / body rows. Cells keep their
 *  raw inline source; escaped pipes (`\|`) are not split on. */
export function parseTable(raw: string): ParsedTable | null {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|") || l.startsWith(":-") || l.startsWith("---"));
  if (lines.length < 2) return null;
  const splitRow = (line: string): string[] =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(/(?<!\\)\|/g)
      .map((c) => c.trim());
  const header = splitRow(lines[0]);
  const align = splitRow(lines[1]);
  const rows = lines.slice(2).map(splitRow);
  return { header, align, rows };
}

function serializeParsedTable(t: ParsedTable): string {
  return [pipeRow(t.header), alignRow(t.align), ...t.rows.map((r) => pipeRow(r))].join("\n");
}

/** Rebuild a table's source with normalized pipes/spacing. */
export function formatTableSource(raw: string): string | null {
  const t = parseTable(raw);
  if (!t) return null;
  return serializeParsedTable(t);
}

/** Row/column transforms for the table toolbar buttons. */
export function transformTable(raw: string, op: "addRow" | "removeRow" | "addCol" | "removeCol"): string | null {
  const t = parseTable(raw);
  if (!t) return null;
  const cols = t.header.length;
  switch (op) {
    case "addRow":
      t.rows.push(Array(cols).fill(""));
      break;
    case "removeRow":
      if (t.rows.length === 0) return null;
      t.rows.pop();
      break;
    case "addCol":
      t.header.push("");
      t.align.push("---");
      for (const r of t.rows) r.push("");
      break;
    case "removeCol":
      if (cols <= 1) return null;
      t.header.pop();
      t.align.pop();
      for (const r of t.rows) r.pop();
      break;
  }
  return serializeParsedTable(t);
}

export class TableWidget extends WidgetType {
  view: EditorView | null = null;

  constructor(readonly raw: string) {
    super();
  }

  // Content-ONLY equality, same rationale as CodeBlockWidget.eq: the toolbar
  // and blur handlers resolve the table's live range at event time, so a
  // reused DOM is always safe — while position-sensitive eq would rebuild the
  // whole markdown-it render on every keystroke typed anywhere else.
  eq(other: TableWidget): boolean {
    return other.raw === this.raw;
  }

  /** Live [from, to] of this widget's table in the CURRENT document, derived
   *  from its DOM position (Lezer `Table` node, with a pipe-line scan
   *  fallback) — never from stored offsets. */
  private currentBlockRange(view: EditorView, root: HTMLElement): { from: number; to: number } | null {
    const hints = domPositionHints(view, root);
    for (const hint of hints) {
      const r = nodeRangeAround(view.state, hint, ["Table"]);
      if (r && r.to > r.from) return r;
    }
    return hints.length > 0 ? tableRangeByScan(view.state, hints[0]) : null;
  }

  toDOM(view: EditorView): HTMLElement {
    this.view = view;
    const wrap = document.createElement("div");
    wrap.className = "cm-table-wrap";

    const div = document.createElement("div");
    div.className = "cm-table";

    const commit = (nextSource: string) => {
      if (!this.view) return;
      const range = this.currentBlockRange(this.view, wrap);
      if (!range) return;
      this.view.dispatch({
        changes: { from: range.from, to: range.to, insert: nextSource },
      });
    };

    const toolbar = document.createElement("div");
    toolbar.className = "cm-table-toolbar";
    const btn = (label: string, op: "addRow" | "removeRow" | "addCol" | "removeCol") => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cm-table-btn";
      b.textContent = label;
      // preventDefault on mousedown keeps focus in the CM6 editor… which also
      // means the cell's blur-commit never runs before this click. Merge the
      // LIVE cell state into the source here, or uncommitted typing would be
      // silently dropped by transforms serializing the stale `raw`.
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.view) return;
        const liveRaw = serializeTableCells(div);
        const base = liveRaw && liveRaw !== this.raw ? liveRaw : this.raw;
        const next = transformTable(base, op);
        if (next && next !== base) commit(next);
      });
      return b;
    };
    toolbar.appendChild(btn("＋ row", "addRow"));
    toolbar.appendChild(btn("− row", "removeRow"));
    toolbar.appendChild(btn("＋ col", "addCol"));
    toolbar.appendChild(btn("− col", "removeCol"));
    wrap.appendChild(toolbar);

    div.innerHTML = renderMarkdownWithTableSource(this.raw);
    // Make each cell editable; edits are committed to the CM6 doc on blur.
    // Cells the user actually edits are marked data-edited so serialization
    // preserves the raw source of untouched cells verbatim (links, bold,
    // entities etc. survive a no-op blur instead of being stripped).
    div.querySelectorAll<HTMLElement>("td, th").forEach((cell) => {
      cell.setAttribute("contenteditable", "true");
      // Snapshot the initial rendered text so serialization can tell whether a
      // marked-edited cell's text actually changed (vs. merely being touched).
      cell.dataset.originalText = cell.textContent ?? "";
      cell.addEventListener("input", () => {
        cell.setAttribute("data-edited", "true");
      });
    });
    div.addEventListener(
      "blur",
      () => {
        if (!this.view) return;
        const newSource = serializeTableCells(div);
        if (newSource && newSource !== this.raw) commit(newSource);
      },
      true,
    );
    wrap.appendChild(div);
    return wrap;
  }

  // The widget owns contenteditable cells and toolbar buttons: CM6 must ignore
  // ALL events inside it (not just mouse events), otherwise key/input events
  // fall through to CM6's input pipeline and get dispatched at the doc-end
  // cursor instead of editing the cell in place. The browser drives all
  // editing; commit-on-blur writes the result back to the doc.
  ignoreEvent(): boolean {
    return true;
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
  // If the rendered text is unchanged from render time, the user only touched
  // the cell without changing it — preserve the source verbatim so inline
  // formats (links/bold) aren't stripped by comparing rendered text vs source.
  if (text === (cell.dataset.originalText ?? "").trim()) {
    return src.replace(/\|/g, "\\|");
  }
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
  view: EditorView | null = null;
  from = -1;
  to = -1;

  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: TaskCheckboxWidget): boolean {
    // Position is part of equality: stale marker ranges in a reused DOM would
    // toggle the WRONG `[ ]`/`[x]` token after text is inserted above it.
    return other.checked === this.checked && other.from === this.from && other.to === this.to;
  }

  toDOM(view: EditorView): HTMLElement {
    this.view = view;
    const label = document.createElement("label");
    label.className = "cm-task-toggle";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    // NOT disabled: the checkbox is interactive. Clicks/space toggle the
    // source marker in the document directly; CM6 is told to ignore mouse
    // events inside the widget so its own input pipeline never interferes.
    input.addEventListener("click", (e) => {
      // The default (native checked toggle) would only change this widget's
      // visual state; the real state lives in the `[ ]`/`[x]` source, which
      // we update and let the widget rebuild from.
      e.preventDefault();
      e.stopPropagation();
      this.toggle();
    });
    input.addEventListener("change", () => {
      // Keyboard (space) path: the native toggle already flipped `checked`;
      // write the new state back to the source marker.
      if (this.view && this.from >= 0 && this.to >= 0) {
        this.view.dispatch({
          changes: { from: this.from, to: this.to, insert: input.checked ? "[x]" : "[ ]" },
        });
      }
    });
    label.appendChild(input);
    return label;
  }

  private toggle(): void {
    if (!this.view || this.from < 0 || this.to < 0) return;
    this.view.dispatch({
      changes: { from: this.from, to: this.to, insert: this.checked ? "[ ]" : "[x]" },
    });
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

    // Click to view the image full-size (lightbox overlay). stopPropagation so
    // CM6 doesn't also move the cursor into the image token.
    img.addEventListener("click", (e) => {
      e.stopPropagation();
      openLightbox(img.currentSrc || img.src);
    });

    wrap.appendChild(img);
    appendSourceBadge(wrap, this.from, this.to);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Fullscreen lightbox overlay for clicking an image. Click anywhere or press
 *  Escape to close. */
export function openLightbox(src: string): void {
  const overlay = document.createElement("div");
  overlay.className = "cm-lightbox";
  // Focusable overlay: without tabindex, focus() on it is a no-op and the
  // Escape keydown listener below never fires (the <img> can't be focused).
  overlay.tabIndex = -1;
  const img = document.createElement("img");
  img.className = "cm-lightbox-img";
  img.src = src;
  img.alt = "";
  overlay.appendChild(img);
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  overlay.addEventListener("click", close);
  // Capture-phase document listener catches Escape even when focus drifted
  // back into the editor after the overlay opened.
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
  overlay.focus();
}

/** Rendered `[[wikilink]]`: shows the alias (or basename) as a clickable link.
 *  Resolved links open on Ctrl+click; unresolved links create the note on
 *  click. The raw target token is kept on the element for the click handler. */
export class WikiLinkWidget extends WidgetType {
  from = 0;
  to = 0;
  readonly label: string;

  constructor(
    readonly target: string,
    readonly resolved: boolean,
  ) {
    super();
    this.label = wikiLabel(target);
  }

  eq(other: WikiLinkWidget): boolean {
    return other.target === this.target && other.resolved === this.resolved;
  }

  toDOM(): HTMLElement {
    const a = document.createElement("span");
    a.className = "cm-wikilink" + (this.resolved ? "" : " cm-wikilink-unresolved");
    a.textContent = this.label;
    a.dataset.wikiTarget = this.target;
    a.title = this.resolved ? `Open ${this.target}` : `Create note: ${this.target}`;
    return a;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Obsidian-style callout card (`> [!note] ...`). */
/** Horizontal rule (---): a plain themed line. */
export class HrWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const div = document.createElement("div");
    div.className = "cm-hr";
    return div;
  }
}

/** Obsidian-Dataview ```table query: runs the DQL against the vault and
 *  renders the result as a table. Rows click through to their notes. */
export class DataviewWidget extends WidgetType {
  view: EditorView | null = null;

  constructor(readonly code: string) {
    super();
  }

  eq(other: DataviewWidget): boolean {
    return other.code === this.code;
  }

  toDOM(view: EditorView): HTMLElement {
    this.view = view;
    const div = document.createElement("div");
    div.className = "cm-dataview cm-dataview-loading";
    div.textContent = "dataview …";
    void this.load(div);
    return div;
  }

  private async load(div: HTMLElement): Promise<void> {
    const query = parseDataviewQuery(this.code);
    if (!query) {
      div.className = "cm-dataview cm-dataview-error";
      div.textContent = "dataview: unsupported query (expected table/from lines)";
      return;
    }
    const ctx = this.view?.state.facet(markdownContextFacet)[0];
    if (!ctx) {
      div.className = "cm-dataview cm-dataview-error";
      div.textContent = "dataview: no vault open";
      return;
    }
    try {
      const { queryDataviewRows } = await import("../lib/ipc");
      let rows = await queryDataviewRows(ctx.vaultRoot, query.from);
      if (query.sortField) {
        const f = query.sortField;
        rows = [...rows].sort((a, b) =>
          query.sortDir === "desc" ? compareByField(b, a, f) : compareByField(a, b, f),
        );
      }
      div.className = "cm-dataview";
      div.textContent = "";

      const table = document.createElement("table");
      table.className = "cm-dataview-table";
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const col of query.columns) {
        const th = document.createElement("th");
        th.textContent = col.label;
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      for (const row of rows) {
        const tr = document.createElement("tr");
        tr.className = "cm-dataview-row";
        tr.title = row.path;
        tr.addEventListener("click", () => {
          void import("../lib/openNote").then((m) => m.openNote(ctx.vaultRoot, row.path));
        });
        for (const col of query.columns) {
          const td = document.createElement("td");
          td.textContent = fieldValue(row, col.field);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      div.appendChild(table);

      const count = document.createElement("div");
      count.className = "cm-dataview-count";
      count.textContent = `${rows.length} notes`;
      div.appendChild(count);
    } catch (e) {
      div.className = "cm-dataview cm-dataview-error";
      div.textContent = `dataview: ${String(e)}`;
    }
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export class CalloutWidget extends WidgetType {
  constructor(readonly type: string, readonly body: string) {
    super();
  }

  eq(other: CalloutWidget): boolean {
    return other.type === this.type && other.body === this.body;
  }

  toDOM(): HTMLElement {
    const div = document.createElement("div");
    const cls = this.type.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    div.className = `cm-callout cm-callout-${cls}`;
    const title = document.createElement("div");
    title.className = "cm-callout-title";
    title.textContent = this.type;
    div.appendChild(title);
    const content = document.createElement("div");
    content.className = "cm-callout-body";
    content.innerHTML = renderMarkdown(this.body);
    div.appendChild(content);
    return div;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Embedded note (`![[target]]` or `![[target#heading]]`). Renders the target
 *  file's content (or a single section) into a card. Only one level deep, so
 *  embeds inside embeds stay as literal source — no recursion risk. */
export class EmbedWidget extends WidgetType {
  view: EditorView | null = null;

  constructor(readonly target: string, readonly heading: string | null) {
    super();
  }

  eq(other: EmbedWidget): boolean {
    return other.target === this.target && other.heading === this.heading;
  }

  toDOM(view: EditorView): HTMLElement {
    this.view = view;
    const div = document.createElement("div");
    div.className = "cm-embed cm-embed-loading";
    div.textContent = `Loading ${this.target}…`;
    void this.load(div);
    return div;
  }

  private async load(div: HTMLElement): Promise<void> {
    const ctx = this.view?.state.facet(markdownContextFacet)[0];
    if (!ctx) return;
    const { resolveWikiLink } = await import("./wikiIndex");
    const resolved = resolveWikiLink(this.target);
    div.textContent = "";
    if (!resolved) {
      div.textContent = `![[${this.target}]]`;
      return;
    }
    try {
      const { readFile } = await import("../lib/ipc");
      const content = await readFile(ctx.vaultRoot, resolved);
      let body = content;
      if (this.heading) {
        body = extractSection(content, this.heading);
      }
      div.className = "cm-embed";
      div.innerHTML = renderMarkdown(body);
    } catch {
      div.textContent = `![[${this.target}]]`;
    }
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The text under `heading` up to the next same-or-higher-level heading
 *  (leading blank lines stripped). Returns "" when the heading isn't found.
 *  Exported for tests. */
export function extractSection(content: string, heading: string): string {
  const re = new RegExp(`^#{1,6}\\s+${escapeRegExp(heading)}\\s*$`, "m");
  const m = re.exec(content);
  if (!m) return "";
  const level = (m[0].match(/^#+/) ?? [""])[0].length;
  const rest = content.slice(m.index + m[0].length).replace(/^\n+/, "");
  const nextRe = new RegExp(`^#{1,${level}}\\s+`, "m");
  const n = nextRe.exec(rest);
  return n ? rest.slice(0, n.index) : rest;
}
