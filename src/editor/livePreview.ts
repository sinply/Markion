import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { syntaxTree, ensureSyntaxTree } from "@codemirror/language";
import { RangeSetBuilder, EditorState, StateField, Text } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CodeBlockWidget, TableWidget, TaskCheckboxWidget, ImageWidget, MathBlockWidget, MathInlineWidget, PreviewWidget, WikiLinkWidget, CalloutWidget, EmbedWidget, FrontmatterWidget, HrWidget, DataviewWidget, resolveBadgeRange } from "./widgets";
import { markdownContextFacet, type MarkdownContext } from "./media";
import { extractFrontmatter, parseFrontmatter } from "../lib/frontmatter";
import { resolveWikiLink, wikiHeading } from "./wikiIndex";

interface DecoEntry {
  from: number;
  to: number;
  decoration: Decoration;
}

/** StateField holding live-preview decorations, provided via
 *  EditorView.decorations.from(field) so line-spanning block widgets are allowed
 *  (plugin-provided decorations cannot replace line breaks).
 */
export const livePreviewField = StateField.define<DecorationSet>({
  create(state: EditorState) {
    return buildDecorations(state);
  },
  update(decos: DecorationSet, tr) {
    // Rebuild on EVERY transaction — selection moves, folds, theme/focus
    // reconfigures, plugin effects. Gating on docChanged||selection left a
    // hole: any other transaction kept the OLD decoration set, which showed
    // up as "### (and other markers) stay until the next click". Cost is
    // fine: buildDecorations reuses the per-doc scan cache and only re-runs
    // the linear decide pass.
    void decos;
    return buildDecorations(tr.state);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Preview-mode StateField: replaces the entire doc with a read-only rendered
 *  PreviewWidget. Provided via EditorView.decorations.from so block replacement
 *  of the whole document is allowed.
 */
export const previewField = StateField.define<DecorationSet>({
  create(state: EditorState) {
    return Decoration.set([
      Decoration.replace({
        widget: new PreviewWidget(state.doc.toString()),
        block: true,
      }).range(0, state.doc.length),
    ]);
  },
  update(_decos: DecorationSet, tr) {
    if (!tr.docChanged) return _decos;
    return Decoration.set([
      Decoration.replace({
        widget: new PreviewWidget(tr.state.doc.toString()),
        block: true,
      }).range(0, tr.state.doc.length),
    ]);
  },
  provide: (f) => EditorView.decorations.from(f),
});

function hiddenMark(): Decoration {
  return Decoration.mark({ attributes: { class: "cm-hidden cm-mark" } });
}

/** Mark a syntax marker as hidden — unless the cursor is inside the marker's
 *  OWN syntax node (Typora behavior). The old rule kept markers visible for
 *  the whole cursor LINE, so freshly typed `**bold**` / [links](url) looked
 *  broken until you moved to another line. Now the pair renders as soon as
 *  the cursor steps out of it, even mid-line; step back in and the raw
 *  source reappears for editing. */
function markHiddenAt(
  state: EditorState,
  _markFrom: number,
  _markTo: number,
  nodeFrom: number,
  nodeTo: number,
): Decoration {
  const head = state.selection.main.head;
  if (head >= nodeFrom && head <= nodeTo) {
    return Decoration.mark({ attributes: { class: "cm-active-line-mark", style: "opacity:0.55" } });
  }
  return hiddenMark();
}

/** True if a node range spans the active (cursor) line — in that case the
 *  block should stay as editable source instead of a read-only widget. */
function isOnActiveLine(state: EditorState, from: number, to: number, activeLine: number): boolean {
  if (activeLine < 0) return false;
  const lineFrom = state.doc.lineAt(from).number;
  const lineTo = state.doc.lineAt(to).number;
  return lineFrom <= activeLine && activeLine <= lineTo;
}

/** True when the cursor sits within [from,to] — the node-granularity trigger
 *  for revealing raw source (inline marks and the frontmatter block). */
function cursorInside(state: EditorState, from: number, to: number): boolean {
  const head = state.selection.main.head;
  return head >= from && head <= to;
}

/** The 1-based line the selection cursor is on, or -1 if unknown. */
function activeLineOf(state: EditorState): number {
  const head = state.selection.main.head;
  return state.doc.lineAt(head).number;
}

/** Extract src + alt from an Image node (alt via regex, src via URL child). */
function imageSrcAltFromNode(state: EditorState, node: SyntaxNode): { src: string; alt: string } {
  let src = "";
  const cur = node.cursor();
  if (cur.firstChild()) {
    do {
      if (cur.type.name === "URL") {
        src = state.doc.sliceString(cur.from, cur.to);
      }
    } while (cur.nextSibling());
  }
  const m = state.doc.sliceString(node.from, node.to).match(/^!\[(.*)\]\s*\(/s);
  return { src, alt: m ? m[1] : "" };
}

/** Resolve the URL of the Link/Autolink node containing `pos` (walks parents). */
export function resolveLinkUrl(state: EditorState, pos: number): string | null {
  let cur: SyntaxNode | null = syntaxTree(state).resolve(pos, -1);
  while (cur) {
    const name = cur.type.name;
    if (name === "Link" || name === "Autolink") {
      const c = cur.cursor();
      if (c.firstChild()) {
        do {
          if (c.type.name === "URL") {
            return state.doc.sliceString(c.from, c.to);
          }
        } while (c.nextSibling());
      }
      return null;
    }
    cur = cur.parent;
  }
  return null;
}

/** Only external http(s) links open in the system browser. */
export function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Resolve an internal markdown link URL (`./x.md`, `../x.md`, `/x.md`) to a
 *  vault-relative path, or null when it isn't a local note link. */
export function resolveInternalPath(docRel: string, url: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    decoded = url;
  }
  // Drop fragment / query parts.
  decoded = decoded.split("#")[0].split("?")[0];
  // Anything with a URL scheme (https:, mailto:, file:…) is not a note link.
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded)) return null;
  const normalized = decoded.replace(/\\/g, "/");
  if (!/\.(md|markdown)$/i.test(normalized)) return null;
  // Absolute OS paths (e.g. C:\...) are outside the vault — ignore.
  if (/^[a-zA-Z]:\//.test(normalized)) return null;
  // Leading `/` means vault-root-relative in markdown convention.
  if (normalized.startsWith("/")) return normalizeRel(normalized.replace(/^\/+/, ""));
  const docDir = docRel.includes("/") ? docRel.slice(0, docRel.lastIndexOf("/")) : "";
  return normalizeRel(docDir ? `${docDir}/${normalized}` : normalized);
}

/** Collapse `.`/`..` segments in a posix-style relative path. */
function normalizeRel(rel: string): string {
  const out: string[] = [];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/** Build the live-preview DecorationSet for `state`.
 *
 *  Performance: the expensive part (walking the Lezer tree + regex-scanning
 *  the whole doc for math/wikilinks) is separated into `scanBlocks`, whose
 *  result is cached per document (see `scanCache`). A selection-only change
 *  reuses the cached scan and only re-runs the linear `decideEntries` pass;
 *  moving the cursor within the same line reuses the previous DecorationSet
 *  entirely.
 */
export function buildDecorations(state: EditorState): DecorationSet {
  // Cache key: document Text AND the fully-expanded syntax tree. Text is
  // immutable so selection-only updates reuse the scan. The tree object is
  // the one ensureSyntaxTree returns — it reflects how far the lazy parser
  // has expanded. On a fresh doc the first scan forces a full parse; once the
  // tree reaches doc.length its identity stops changing and the cache hits.
  // (Keying on Text alone froze decorations at the first viewport-sized parse
  // window, leaving everything past ~100 lines as raw source.)
  const doc = state.doc;
  const tree = ensureSyntaxTree(state, doc.length, 1500) ?? syntaxTree(state);
  let cache = scanCache.get(doc);
  if (!cache || cache.tree !== tree) {
    cache = { tree, blocks: scanBlocks(state, tree), lastHead: -1, lastSet: null };
    scanCache.set(doc, cache);
  }
  // Node-granularity rule: markers show/hide per CURSOR POSITION now (inside
  // a syntax node = raw source), not per line. So the reuse check must be
  // the exact head — reusing per line swallowed same-line cursor moves and
  // kept `**bold**` raw after typing it.
  const head = state.selection.main.head;
  if (cache.lastHead === head && cache.lastSet) {
    return cache.lastSet;
  }
  const entries = decideEntries(state, cache.blocks);
  const set = buildSet(entries);
  cache.lastHead = head;
  cache.lastSet = set;
  return set;
}

// ---- Scan / decide split ----

interface ScanCache {
  tree: Tree;
  blocks: Block[];
  lastHead: number;
  lastSet: DecorationSet | null;
}

const scanCache = new WeakMap<Text, ScanCache>();

type BlockKind =
  | "style"       // styled span, optionally with hidden sub-marker ranges
  | "marks"       // standalone hidden markers (ListMark, outer link brackets)
  | "link"        // link text span with fixed-hidden brackets
  | "image"       // image widget (skipped on active line)
  | "hr"          // horizontal rule widget
  | "dataview"    // dataview table-query widget
  | "code"        // fenced code widget (skipped on active line)
  | "table"       // GFM table widget (skipped on active line)
  | "task"        // task checkbox widget (skipped on active line)
  | "mathBlock"   // $$...$$ widget (skipped on active line)
  | "mathInline"  // $...$ widget (skipped on active line)
  | "wiki"        // [[wikilink]] widget (skipped on active line)
  | "embed"       // ![[note]] embed widget (skipped on active line)
  | "callout"     // > [!type] callout card (skipped on active line)
  | "frontmatter";

interface Block {
  kind: BlockKind;
  from: number;
  to: number;
  /** Sub-ranges hidden with the active-line-aware mark treatment. */
  markList?: { from: number; to: number }[];
  /** Class applied to the whole [from,to] span (with styleAttr). */
  styleClass?: string;
  styleAttr?: string;
  /** Cursor-sensitivity range for marker hiding, when different from
   *  [from,to] (a link's [from,to] is just its title text; the raw source
   *  must also reappear when the cursor is over the URL part). */
  spanFrom?: number;
  spanTo?: number;
  // Widget payloads:
  code?: string;
  lang?: string;
  tableRaw?: string;
  checked?: boolean;
  src?: string;
  alt?: string;
  tex?: string;
  wikiTarget?: string;
  wikiResolved?: boolean;
  embedTarget?: string;
  embedHeading?: string | null;
  calloutType?: string;
  calloutBody?: string;
  hr?: boolean;
}

function collectMarks(node: SyntaxNode, name: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const cur = node.cursor();
  if (cur.firstChild()) {
    do {
      if (cur.type.name === name) out.push({ from: cur.from, to: cur.to });
    } while (cur.nextSibling());
  }
  return out;
}

const CALLOUT_TYPES = [
  "note", "tip", "warning", "danger", "info", "success",
  "question", "todo", "abstract", "summary", "important",
  "caution", "failure", "bug", "example", "quote",
];

/** Detect `> [!type]` callout blockquotes. Returns the type and the body:
 *  the remainder of the first line after `[!type]` plus the following lines,
 *  with `> ` prefixes stripped. Exported for tests. */
export function parseCallout(raw: string): { type: string; body: string } | null {
  const lines = raw.split("\n");
  if (lines.length === 0) return null;
  const first = lines[0].replace(/^>\s?/, "");
  const m = /^\[!([a-z-]+)\]\s*(.*)$/is.exec(first);
  if (!m) return null;
  const type = m[1].toLowerCase();
  if (!CALLOUT_TYPES.includes(type)) return null;
  const headRest = m[2] ?? "";
  const rest = lines.slice(1).map((l) => l.replace(/^>\s?/, ""));
  const body = [headRest, ...rest].join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
  return { type, body };
}

/** Walk the Lezer tree + regex-scan the doc once, producing a flat block list
 *  with no view-state (active line) baked in. `tree` is the FULLY-EXPANDED
 *  parse (see buildDecorations): scanBlocks never uses syntaxTree(state) on
 *  its own, because a long note's viewport-only tree would skip everything
 *  past the first screenful (headings/code/tables render as raw source). */
export function scanBlocks(state: EditorState, tree: Tree): Block[] {
  const blocks: Block[] = [];
  const docText = state.doc.toString();

  // Frontmatter FIRST: everything inside the leading ---...--- block is
  // property metadata, NOT markdown. Detect it up front and skip it in the
  // iterate and regex scans below — otherwise the --- fences would ALSO
  // parse as HorizontalRule nodes and double-replace the same range (the
  // opening --- then renders as a stray — horizontal rule).
  // Use the shared extractFrontmatter so live preview, full-doc preview, and
  // the Properties dialog agree on what a frontmatter block is — a duplicate
  // regex here used to diverge (empty block, BOM, leading blank lines) and
  // silently render the marker as a horizontal rule.
  let fmEnd = -1;
  const fm = extractFrontmatter(docText);
  if (fm) {
    fmEnd = fm.end;
    blocks.push({ kind: "frontmatter", from: 0, to: fm.end });
  }
  const insideFrontmatter = (pos: number): boolean => fmEnd >= 0 && pos < fmEnd;

  // Ranges of every fenced/indented/inline code span. Regex-based scans below
  // (math, wikilinks) must skip matches inside these, otherwise a `$x$` or
  // `[[...]]` inside code would create a decoration overlapping the block
  // widget and the RangeSet build would drop the whole block.
  const codeRanges: { from: number; to: number }[] = [];

  const insideCode = (pos: number): boolean =>
    codeRanges.some((r) => pos >= r.from && pos < r.to);

  tree.iterate({
    enter(node) {
      const { name: type } = node.type;

      // Skip everything inside the frontmatter block — BUT never prune the
      // Document root: its from==0 sits inside the block, and returning false
      // there skips the ENTIRE tree (headings, code blocks, tables all
      // vanish). Only real content nodes are guarded.
      if (type !== "Document" && insideFrontmatter(node.from)) return false;

      // --- Inline: Emphasis + StrongEmphasis (hide markers, style content) ---
      if (type === "Emphasis" || type === "StrongEmphasis") {
        blocks.push({
          kind: "style",
          from: node.from, to: node.to,
          styleClass: "cm-emphasis",
          styleAttr: type === "StrongEmphasis" ? "font-weight:700" : "font-style:italic",
          markList: collectMarks(node.node, "EmphasisMark"),
        });
        return false;
      }

      // --- Inline: GFM strikethrough (~~text~~) — was never handled, so the
      //     tildes stayed visible forever. Hide marks + strike the content. ---
      if (type === "Strikethrough") {
        blocks.push({
          kind: "style",
          from: node.from, to: node.to,
          styleClass: "cm-strikethrough",
          markList: collectMarks(node.node, "StrikethroughMark"),
        });
        return false;
      }

      // --- Inline: ^super^ / ~sub~ (needs the Superscript/Subscript lezer
      //     extensions, now enabled in codemirror.ts) ---
      if (type === "Superscript" || type === "Subscript") {
        blocks.push({
          kind: "style",
          from: node.from, to: node.to,
          styleClass: type === "Superscript" ? "cm-superscript" : "cm-subscript",
          markList: collectMarks(node.node, type === "Superscript" ? "SuperscriptMark" : "SubscriptMark"),
        });
        return false;
      }

      // --- Block: horizontal rule (--- / *** / ___) renders as a line ---
      if (type === "HorizontalRule") {
        blocks.push({ kind: "hr", from: node.from, to: node.to });
        return false;
      }

      // --- Inline: code ---
      if (type === "InlineCode") {
        // Markers are separate block entries; decideEntries pushes them before
        // the whole-span mark (same `from`) so the RangeSet build doesn't
        // collide on equal ranges.
        blocks.push({
          kind: "style",
          from: node.from, to: node.to,
          styleClass: "cm-inline-code",
          markList: collectMarks(node.node, "CodeMark"),
        });
        // Regex scans (math / wikilinks) must also skip inline code.
        codeRanges.push({ from: node.from, to: node.to });
        return false;
      }

      // --- Inline: images ---
      if (type === "Image") {
        const { src, alt } = imageSrcAltFromNode(state, node.node);
        blocks.push({ kind: "image", from: node.from, to: node.to, src, alt });
        return false;
      }

      // --- Inline: links ---
      if (type === "Link") {
        const children: { name: string; from: number; to: number; node: SyntaxNode }[] = [];
        const cur = node.node.cursor();
        if (cur.firstChild()) {
          do {
            children.push({ name: cur.type.name, from: cur.from, to: cur.to, node: cur.node });
          } while (cur.nextSibling());
        }

        // Image nested in a link: render the image, hide only the outer brackets.
        const imgChild = children.find((c) => c.name === "Image");
        if (imgChild) {
          const { src, alt } = imageSrcAltFromNode(state, imgChild.node);
          blocks.push({ kind: "image", from: imgChild.from, to: imgChild.to, src, alt });
          const outer = children
            .filter((c) => c.name === "LinkMark" && (c.from < imgChild.from || c.to > imgChild.to))
            .map((c) => ({ from: c.from, to: c.to }));
          if (outer.length > 0) {
            blocks.push({ kind: "marks", from: node.from, to: node.to, markList: outer });
          }
          return false;
        }

        // Link text = content after the opening [ bracket up to the URL.
        // GFM parses links as: LinkMark[ [, LinkMark[ ], LinkMark[(, URL, LinkMark[)
        // with the visible text as a raw range between from+1 and the URL.
        const doc = state.doc.toString();
        const rest = doc.slice(node.from + 1, node.to);
        const urlIdx = rest.indexOf("](");
        // The syntax to hide when the cursor is away from this line: the
        // brackets AND the URL itself, so previews read as a clean title link
        // (Obsidian-style) instead of "title + raw URL". On the active line
        // they reappear (semi-transparent) so the source is editable.
        const markers: { from: number; to: number }[] = children
          .filter((c) => c.name === "LinkMark")
          .map((c) => ({ from: c.from, to: c.to }));
        if (urlIdx >= 0) {
          const urlFrom = node.from + 1 + urlIdx + 2; // after "]("
          const urlTo = node.to - 1; // before the closing ")"
          if (urlTo > urlFrom) markers.push({ from: urlFrom, to: urlTo });
          blocks.push({
            kind: "link",
            from: node.from + 1,
            to: node.from + 1 + urlIdx,
            styleClass: "cm-link",
            styleAttr: "color:#0366d6;text-decoration:underline;cursor:pointer",
            markList: markers,
            spanFrom: node.from,
            spanTo: node.to,
          });
        } else {
          blocks.push({ kind: "link", from: node.from, to: node.to, markList: markers });
        }
        return false;
      }

      // --- Headings (ATXHeading1..6, SetextHeading1/2): hide #, enlarge content ---
      if (type.startsWith("ATXHeading") || type.startsWith("SetextHeading")) {
        const m = type.match(/(\d)$/);
        const level = m ? Math.min(parseInt(m[1], 10), 6) : 1;
        const sizes = ["1.8em", "1.5em", "1.3em", "1.15em", "1em", "0.9em"];
        blocks.push({
          kind: "style",
          from: node.from, to: node.to,
          styleClass: "cm-heading",
          styleAttr: `font-size:${sizes[level - 1]};font-weight:600;`,
          markList: collectMarks(node.node, "HeaderMark"),
        });
        // Deliberately do NOT return false: inline syntax INSIDE the heading
        // (**bold**, `code`, [links], [[wikilinks]]) must still be processed,
        // otherwise the raw markers show through (a heading title renders as
        // literal **bold**). The heading's own mark decoration nests around
        // the children's marks/replacements, which RangeSet allows.
      }

      // --- Blockquote: hide the `>` mark(s), then style the content ---
      if (type === "Blockquote") {
        // Obsidian-style callout: `> [!note]` first line → render as a card.
        const quoteText = state.doc.sliceString(node.from, node.to);
        const callout = parseCallout(quoteText);
        if (callout) {
          blocks.push({
            kind: "callout",
            from: node.from, to: node.to,
            calloutType: callout.type,
            calloutBody: callout.body,
          });
          return false;
        }
        blocks.push({
          kind: "style",
          from: node.from, to: node.to,
          styleClass: "cm-blockquote",
          styleAttr: "border-left:3px solid #dfe2e5;padding-left:12px;color:#6a737d;",
          markList: collectMarks(node.node, "QuoteMark"),
        });
        return false;
      }

      // --- List bullet/number marker ---
      if (type === "ListMark") {
        blocks.push({
          kind: "marks",
          from: node.from, to: node.to,
          markList: [{ from: node.from, to: node.to }],
        });
        return false;
      }

      // --- Block: FencedCode / indented CodeBlock ---
      if (type === "FencedCode" || type === "CodeBlock") {
        // Extract lang + body from the Lezer nodes instead of slicing fence
        // lines by hand: that approach broke on 4-backtick fences (info line
        // kept a stray backtick), blank lines after the fence, and unclosed
        // fences (the last content line was eaten as a "closing" fence).
        let lang = "";
        let codeText: string | null = null;
        const cur = node.node.cursor();
        if (cur.firstChild()) {
          do {
            const child = cur.type.name;
            if (child === "CodeInfo") {
              lang = state.doc.sliceString(cur.from, cur.to).trim();
            } else if (child === "CodeText") {
              codeText = state.doc.sliceString(cur.from, cur.to);
            }
          } while (cur.nextSibling());
        }
        if (codeText === null) {
          // Indented code block: no CodeText child, strip the node's text.
          const text = state.doc.sliceString(node.from, node.to);
          codeText = text
            .replace(/^\n+/, "")
            .replace(/\n+$/, "")
            .replace(/\n {4}/g, "\n");
        }
        if (lang.toLowerCase() === "dataview") {
          // Dataview query: render as a live result table, not a code card.
          blocks.push({
            kind: "dataview",
            from: node.from, to: node.to,
            code: codeText.replace(/^\n+/, "").replace(/\n+$/, ""),
          });
          codeRanges.push({ from: node.from, to: node.to });
          return false;
        }
        blocks.push({
          kind: "code",
          from: node.from, to: node.to,
          code: codeText.replace(/^\n+/, "").replace(/\n+$/, ""),
          lang,
        });
        codeRanges.push({ from: node.from, to: node.to });
        return false;
      }

      // --- Block: Table (GFM) ---
      if (type === "Table") {
        blocks.push({
          kind: "table",
          from: node.from, to: node.to,
          tableRaw: state.doc.sliceString(node.from, node.to),
        });
        return false;
      }

      // --- Block: Task / TaskMarker (GFM) ---
      if (type === "Task" || type === "TaskMarker") {
        if (type === "TaskMarker") {
          const checked = /^\[[xX]\]$/.test(state.doc.sliceString(node.from, node.to));
          blocks.push({ kind: "task", from: node.from, to: node.to, checked });
        } else {
          const cur = node.node.cursor();
          if (cur.firstChild()) {
            do {
              if (cur.type.name === "TaskMarker") {
                const checked = /^\[[xX]\]$/.test(state.doc.sliceString(cur.from, cur.to));
                blocks.push({ kind: "task", from: cur.from, to: cur.to, checked });
              }
            } while (cur.nextSibling());
          }
        }
        return false;
      }
    },
  });

  // (Frontmatter was already detected and pushed at the TOP of scanBlocks;
  // everything inside it is skipped by the iterate and the regex scans below.)

  // --- Block math: $$...$$ (Lezer markdown has no math nodes; scan the doc) ---
  const mathRe = /\$\$([\s\S]+?)\$\$/g;
  const blockMathRanges: { from: number; to: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = mathRe.exec(docText)) !== null) {
    const from = m.index;
    const to = m.index + m[0].length;
    if (insideCode(from) || insideFrontmatter(from)) continue; // `$$` inside a code block is code, not math
    blockMathRanges.push({ from, to });
    blocks.push({ kind: "mathBlock", from, to, tex: m[1].trim() });
  }

  // --- Inline math: $...$ (single dollar, not part of $$...$$) ---
  // A crude-but-robust scan: find `$` pairs on the same line, non-empty,
  // not preceded/followed by another `$`. Block-math ranges are skipped with a
  // two-pointer walk (both the regex and the range list advance left-to-right),
  // which keeps this O(matches + blocks) instead of O(matches * blocks).
  const inlineMathRe = /(?<![\$\\])\$([^\$\n]+?)\$(?!\$)/g;
  let im: RegExpExecArray | null;
  let bmi = 0;
  while ((im = inlineMathRe.exec(docText)) !== null) {
    while (bmi < blockMathRanges.length && blockMathRanges[bmi].to <= im.index) bmi++;
    if (bmi < blockMathRanges.length && im.index >= blockMathRanges[bmi].from && im.index < blockMathRanges[bmi].to) {
      continue; // inside a block math range
    }
    if (insideCode(im.index)) continue; // `$x$` inside code is code, not math
    blocks.push({
      kind: "mathInline",
      from: im.index,
      to: im.index + im[0].length,
      tex: im[1].trim(),
    });
  }

  // --- Inline: wikilinks [[name]] / [[path/name]] / [[name|alias]], and
  // embeds ![[name]] / ![[name#heading]] ---
  const wikiRe = /(!?)\[\[([^\]\n]+)\]\]/g;
  let wm: RegExpExecArray | null;
  while ((wm = wikiRe.exec(docText)) !== null) {
    const from = wm.index;
    const to = from + wm[0].length;
    if (insideCode(from) || insideFrontmatter(from)) continue; // never render `[[` inside code blocks
    const raw = wm[2].trim();
    if (wm[1] === "!") {
      // Embed: `![[target]]` or `![[target#heading]]`.
      const [filePart, headingPart] = raw.split("#");
      blocks.push({
        kind: "embed",
        from, to,
        embedTarget: (filePart ?? "").split("|")[0].trim(),
        embedHeading: headingPart ? headingPart.trim() : null,
      });
    } else {
      blocks.push({
        kind: "wiki",
        from, to,
        wikiTarget: raw,
        wikiResolved: resolveWikiLink(raw) !== null,
      });
    }
  }

  // --- Inline: #tags (Obsidian-style). Match `#word` not preceded by a
  // word char, skipping code ranges. ATX heading markers (`# Title`) never
  // match because a space follows `#`; `## #tag` still styles the tag.
  const tagRe = /(^|[^\p{L}\p{N}_])#([\p{L}\p{N}_\-\/\u3400-\u9fff]+)/gu;
  let tg: RegExpExecArray | null;
  while ((tg = tagRe.exec(docText)) !== null) {
    const from = tg.index + tg[1].length; // start at the `#`
    const to = tg.index + tg[0].length;
    if (insideCode(from) || insideFrontmatter(from)) continue;
    blocks.push({
      kind: "style",
      from, to,
      styleClass: "cm-tag",
      styleAttr: "color:#005cc5;background:rgba(27,31,35,0.08);border-radius:4px;padding:0 4px;cursor:pointer;",
    });
  }

  // --- Inline: ==highlight== (Obsidian). Rendered live and in preview; the
  // == markers hide unless the cursor is inside the span.
  const markRe = /==([^=\n]+)==/g;
  let hm: RegExpExecArray | null;
  while ((hm = markRe.exec(docText)) !== null) {
    const from = hm.index;
    const to = from + hm[0].length;
    if (insideCode(from) || insideFrontmatter(from)) continue;
    blocks.push({
      kind: "style",
      from, to,
      styleClass: "cm-mark",
      styleAttr: "background:rgba(255,213,89,0.45);border-radius:3px;padding:0 2px;",
      markList: [
        { from, to: from + 2 },
        { from: to - 2, to },
      ],
    });
  }

  return blocks;
}

/** Turn scanned blocks into decorations, applying the active-line decisions. */
function decideEntries(state: EditorState, blocks: Block[]): DecoEntry[] {
  const activeLine = activeLineOf(state);
  const entries: DecoEntry[] = [];

  for (const b of blocks) {
    switch (b.kind) {
      case "style": {
        if (b.markList) {
          for (const mk of b.markList) {
            entries.push({ from: mk.from, to: mk.to, decoration: markHiddenAt(state, mk.from, mk.to, b.from, b.to) });
          }
        }
        if (b.styleClass) {
          const attrs: { class: string; style?: string } = { class: b.styleClass };
          if (b.styleAttr) attrs.style = b.styleAttr;
          entries.push({
            from: b.from, to: b.to,
            decoration: Decoration.mark({ attributes: attrs }),
          });
        }
        break;
      }

      case "marks": {
        for (const mk of b.markList ?? []) {
          entries.push({ from: mk.from, to: mk.to, decoration: markHiddenAt(state, mk.from, mk.to, b.from, b.to) });
        }
        break;
      }

      case "link": {
        const spanFrom = b.spanFrom ?? b.from;
        const spanTo = b.spanTo ?? b.to;
        for (const mk of b.markList ?? []) {
          entries.push({
            from: mk.from, to: mk.to,
            decoration: markHiddenAt(state, mk.from, mk.to, spanFrom, spanTo),
          });
        }
        if (b.styleClass) {
          const attrs: { class: string; style?: string } = { class: b.styleClass };
          if (b.styleAttr) attrs.style = b.styleAttr;
          entries.push({
            from: b.from, to: b.to,
            decoration: Decoration.mark({ attributes: attrs }),
          });
        }
        break;
      }

      case "image": {
        if (isOnActiveLine(state, b.from, b.to, activeLine)) break; // keep source editable
        const w = new ImageWidget(b.src ?? "", b.alt ?? "");
        w.from = b.from;
        w.to = b.to;
        entries.push({ from: b.from, to: b.to, decoration: Decoration.replace({ widget: w }) });
        break;
      }

      case "code": {
        if (isOnActiveLine(state, b.from, b.to, activeLine)) break; // keep source editable
        const w = new CodeBlockWidget(b.code ?? "", b.lang ?? "");
        // No stored offsets: the widget resolves its block range dynamically
        // at event time (content-only eq reuses DOM across moves).
        entries.push({ from: b.from, to: b.to, decoration: Decoration.replace({ widget: w, block: true }) });
        break;
      }

      case "table": {
        if (isOnActiveLine(state, b.from, b.to, activeLine)) break; // keep source editable
        const w = new TableWidget(b.tableRaw ?? "");
        // No stored offsets: the widget resolves its table range dynamically
        // at event time (content-only eq reuses DOM across moves).
        entries.push({ from: b.from, to: b.to, decoration: Decoration.replace({ widget: w, block: true }) });
        break;
      }

      case "task": {
        if (isOnActiveLine(state, b.from, b.to, activeLine)) break; // keep source editable
        const w = new TaskCheckboxWidget(b.checked ?? false);
        // Source range of the `[ ]`/`[x]` marker, so the widget can toggle it.
        // NOT block:true — a block widget renders on its own line, which
        // would split `- [ ] task text` into a lone checkbox tile plus a
        // second .cm-line for the task text. Inline replacement keeps the
        // checkbox and its label on the same line.
        w.from = b.from;
        w.to = b.to;
        entries.push({
          from: b.from, to: b.to,
          decoration: Decoration.replace({ widget: w }),
        });
        break;
      }

      case "mathBlock": {
        if (isOnActiveLine(state, b.from, b.to, activeLine)) break; // keep source editable
        const w = new MathBlockWidget(b.tex ?? "");
        w.from = b.from;
        w.to = b.to;
        entries.push({ from: b.from, to: b.to, decoration: Decoration.replace({ widget: w, block: true }) });
        break;
      }

      case "mathInline": {
        if (isOnActiveLine(state, b.from, b.to, activeLine)) break; // keep source editable
        const w = new MathInlineWidget(b.tex ?? "");
        w.from = b.from;
        w.to = b.to;
        entries.push({ from: b.from, to: b.to, decoration: Decoration.replace({ widget: w }) });
        break;
      }

      case "wiki": {
        if (isOnActiveLine(state, b.from, b.to, activeLine)) break; // keep source editable
        const w = new WikiLinkWidget(b.wikiTarget ?? "", b.wikiResolved ?? false);
        w.from = b.from;
        w.to = b.to;
        entries.push({ from: b.from, to: b.to, decoration: Decoration.replace({ widget: w }) });
        break;
      }

      case "embed": {
        if (isOnActiveLine(state, b.from, b.to, activeLine)) break; // keep source editable
        // Inline (non-block) replacement: embeds can sit mid-line next to
        // other text; a block:true replace would collide with sibling ranges.
        const w = new EmbedWidget(b.embedTarget ?? "", b.embedHeading ?? null);
        entries.push({ from: b.from, to: b.to, decoration: Decoration.replace({ widget: w }) });
        break;
      }

      case "callout": {
        if (isOnActiveLine(state, b.from, b.to, activeLine)) break; // keep source editable
        const w = new CalloutWidget(b.calloutType ?? "note", b.calloutBody ?? "");
        entries.push({ from: b.from, to: b.to, decoration: Decoration.replace({ widget: w, block: true }) });
        break;
      }

      case "hr": {
        // Same rule as other blocks: cursor on it = edit the marker.
        if (isOnActiveLine(state, b.from, b.to, activeLine)) break;
        entries.push({
          from: b.from, to: b.to,
          decoration: Decoration.replace({ widget: new HrWidget(), block: true }),
        });
        break;
      }

      case "dataview": {
        // Same rule as code blocks: cursor inside = raw DQL for editing.
        if (isOnActiveLine(state, b.from, b.to, activeLine)) break;
        entries.push({
          from: b.from, to: b.to,
          decoration: Decoration.replace({ widget: new DataviewWidget(b.code ?? ""), block: true }),
        });
        break;
      }

      case "frontmatter": {
        // Raw YAML only while the cursor is INSIDE the block — half-open at
        // the end: position `to` is the first body character, so a cursor
        // there (where opening a note lands it) still shows the card.
        const fmHead = state.selection.main.head;
        if (fmHead >= b.from && fmHead < b.to) break; // keep source editable
        const fm = extractFrontmatter(state.doc.toString());
        if (!fm || !fm.body.trim()) break;
        entries.push({
          from: b.from, to: b.to,
          decoration: Decoration.replace({ widget: new FrontmatterWidget(parseFrontmatter(fm.body)), block: true }),
        });
        break;
      }
    }
  }

  entries.sort((a, b) => a.from - b.from || a.to - b.to);
  return entries;
}

function buildSet(entries: DecoEntry[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const e of entries) {
    builder.add(e.from, e.to, e.decoration);
  }
  return builder.finish();
}

// ---- ViewPlugin: rebuilds decorations on document/viewport changes ----

class LivePlugin {
  constructor(_view: EditorView) {
    // Initial decorations are built by the StateField's `create`; rebuilds on
    // selection/doc changes happen inside the StateField itself.
  }

  update(_update: ViewUpdate) {
    // Decoration updates now live in the StateField; this plugin only wires
    // click handling (task toggle / external link open) via eventHandlers.
  }
}

export const livePreviewExtension = ViewPlugin.fromClass(LivePlugin, {
  eventHandlers: {
    click(event, view) {
      const target = event.target as HTMLElement;

      // NOTE: task checkbox toggling lives inside TaskCheckboxWidget now (it
      // dispatches the `[ ]`<->`[x]` change itself); this handler must not
      // also toggle, or a click would flip the marker twice.

      // Open external links (also when clicking an image nested inside a link)
      const clickable = target.closest(".cm-image, .cm-link");
      if (clickable) {
        const pos = view.posAtDOM(target);
        const url = resolveLinkUrl(view.state, pos);
        if (url && isExternalUrl(url)) {
          event.preventDefault();
          void openUrl(url);
          return true;
        }
        // Internal markdown links ([text](./other.md)) open the target note.
        if (url) {
          const ctx = view.state.facet(markdownContextFacet)[0];
          if (ctx) {
            const rel = resolveInternalPath(ctx.docRel, url);
            if (rel) {
              event.preventDefault();
              void import("../lib/openNote").then((m) => m.openNote(ctx.vaultRoot, rel));
              return true;
            }
          }
        }
      }

      // Wiki links: Ctrl+click a resolved link opens the target note (a
      // `#heading` anchor scrolls to that heading); clicking an unresolved
      // link creates it. A plain click on a resolved link leaves the default
      // cursor placement so the source stays editable.
      const wikilink = target.closest<HTMLElement>(".cm-wikilink");
      if (wikilink) {
        const ctx = view.state.facet(markdownContextFacet)[0];
        if (!ctx) return false;
        const raw = wikilink.dataset.wikiTarget ?? "";
        const targetPath = resolveWikiLink(raw);
        if (targetPath) {
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            void openWikiLink(ctx, targetPath, wikiHeading(raw) ?? undefined);
            return true;
          }
          return false;
        }
        event.preventDefault();
        void createAndOpenWikiNote(ctx, raw);
        return true;
      }

      // Source badge on image/math widgets: flip that block to source. The
      // badge's stored data-from/to are a construction-time snapshot that goes
      // STALE when edits above move the widget (content-only eq reuses the
      // DOM) — resolve the live position from the widget's DOM first.
      const badge = target.closest<HTMLElement>(".cm-source-badge");
      if (badge) {
        event.preventDefault();
        const range = resolveBadgeRange(view, badge);
        if (!range) return false;
        view.dispatch({ selection: { anchor: range.from }, scrollIntoView: true });
        return true;
      }

      return false;
    },
  },
});

export const LivePreviewPlugin = LivePlugin;

async function openWikiLink(
  ctx: MarkdownContext,
  path: string,
  heading?: string,
): Promise<void> {
  const { openNote } = await import("../lib/openNote");
  await openNote(ctx.vaultRoot, path, { heading });
}

/** Create a missing `[[target]]` note and open it. A target with a `/` is used
 *  as-is (vault-root-relative); a bare name is created next to the current doc
 *  (Obsidian default). A `#heading` anchor is stripped so only the file is
 *  created (Obsidian behavior). */
async function createAndOpenWikiNote(ctx: MarkdownContext, raw: string): Promise<void> {
  const { createFile } = await import("../lib/ipc");
  const { openNote } = await import("../lib/openNote");
  const { useVaultStore } = await import("../stores/vaultStore");
  const target = raw.split("|")[0].split("#")[0].trim();
  if (!target) return;
  // A target containing `..` or an absolute path must not escape the vault
  // root (createFile would happily write `../outside.md`).
  if (/\.\./.test(target) || target.startsWith("/") || /^[a-zA-Z]:/.test(target)) return;
  const docDir = ctx.docRel.includes("/")
    ? ctx.docRel.slice(0, ctx.docRel.lastIndexOf("/"))
    : "";
  const newPath = target.includes("/")
    ? `${target}.md`
    : docDir
      ? `${docDir}/${target}.md`
      : `${target}.md`;
  try {
    await createFile(ctx.vaultRoot, newPath);
    await useVaultStore.getState().loadTree(ctx.vaultRoot);
    await openNote(ctx.vaultRoot, newPath);
  } catch {
    // creation failed — leave the editor unchanged
  }
}
