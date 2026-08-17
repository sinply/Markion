import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, EditorState, StateField, Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CodeBlockWidget, TableWidget, TaskCheckboxWidget, ImageWidget, MathBlockWidget, MathInlineWidget, PreviewWidget, WikiLinkWidget } from "./widgets";
import { markdownContextFacet, type MarkdownContext } from "./media";
import { resolveWikiLink } from "./wikiIndex";

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
    // Rebuild synchronously on selection or doc changes so the block under the
    // cursor switches to editable source immediately. (The old approach — the
    // ViewPlugin dispatching a setDecorations effect — never reached this field,
    // so code blocks / images stayed read-only widgets after the cursor moved.)
    // `buildDecorations` itself is incremental: selection-only updates reuse
    // the cached scan and only re-run the cheap decide pass.
    if (tr.docChanged || tr.selection) {
      return buildDecorations(tr.state);
    }
    return decos.map(tr.changes);
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

/** Mark a syntax marker as hidden — unless it's on the active (cursor) line,
 *  where the source should stay visible so the user can edit it. */
function markHiddenAt(state: EditorState, from: number, to: number, activeLine: number): Decoration {
  if (activeLine >= 0 && state.doc.lineAt(from).number === activeLine) {
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
  // Key the cache by the document Text object: EditorState is immutable, so a
  // selection-only update creates a NEW state object but keeps the SAME Text;
  // only a real doc change swaps the Text. That makes the key exactly match
  // "did the scanned content change?".
  const doc = state.doc;
  let cache = scanCache.get(doc);
  if (!cache) {
    cache = { blocks: scanBlocks(state), lastActiveLine: -1, lastSet: null };
    scanCache.set(doc, cache);
  }
  const activeLine = activeLineOf(state);
  if (cache.lastActiveLine === activeLine && cache.lastSet) {
    return cache.lastSet;
  }
  const entries = decideEntries(state, cache.blocks);
  const set = buildSet(entries);
  cache.lastActiveLine = activeLine;
  cache.lastSet = set;
  return set;
}

// ---- Scan / decide split ----

interface ScanCache {
  blocks: Block[];
  lastActiveLine: number;
  lastSet: DecorationSet | null;
}

const scanCache = new WeakMap<Text, ScanCache>();

type BlockKind =
  | "style"       // styled span, optionally with hidden sub-marker ranges
  | "marks"       // standalone hidden markers (ListMark, outer link brackets)
  | "link"        // link text span with fixed-hidden brackets
  | "image"       // image widget (skipped on active line)
  | "code"        // fenced code widget (skipped on active line)
  | "table"       // GFM table widget (skipped on active line)
  | "task"        // task checkbox widget (skipped on active line)
  | "mathBlock"   // $$...$$ widget (skipped on active line)
  | "mathInline"  // $...$ widget (skipped on active line)
  | "wiki"        // [[wikilink]] widget (skipped on active line)
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

/** Walk the Lezer tree + regex-scan the doc once, producing a flat block list
 *  with no view-state (active line) baked in. */
function scanBlocks(state: EditorState): Block[] {
  const blocks: Block[] = [];
  const tree = syntaxTree(state);
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
        return false;
      }

      // --- Blockquote: hide the `>` mark(s), then style the content ---
      if (type === "Blockquote") {
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

  // YAML frontmatter: keep it as editable source, but give it a subtle
  // background bar (not highlighted) so it reads as a distinct panel.
  // Frontmatter can only ever sit at the very top of a note, so bound the
  // regex to the first 100 lines: a doc that starts with `---` but never
  // closes it can't make the lazy scan run to EOF.
  const docText = state.doc.toString();
  let head = docText;
  {
    let pos = 0;
    for (let i = 0; i < 100; i++) {
      const nl = docText.indexOf("\n", pos);
      if (nl < 0) { pos = docText.length; break; }
      pos = nl + 1;
    }
    if (pos < docText.length) head = docText.slice(0, pos);
  }
  const fmMatch = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(head);
  if (fmMatch) {
    blocks.push({ kind: "frontmatter", from: 0, to: fmMatch[0].length });
  }

  // --- Block math: $$...$$ (Lezer markdown has no math nodes; scan the doc) ---
  const mathRe = /\$\$([\s\S]+?)\$\$/g;
  const blockMathRanges: { from: number; to: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = mathRe.exec(docText)) !== null) {
    const from = m.index;
    const to = m.index + m[0].length;
    if (insideCode(from)) continue; // `$$` inside a code block is code, not math
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

  // --- Inline: wikilinks [[name]] / [[path/name]] / [[name|alias]] ---
  const wikiRe = /\[\[([^\]\n]+)\]\]/g;
  let wm: RegExpExecArray | null;
  while ((wm = wikiRe.exec(docText)) !== null) {
    const from = wm.index;
    const to = from + wm[0].length;
    if (insideCode(from)) continue; // never render `[[` inside code blocks
    const target = wm[1].trim();
    blocks.push({
      kind: "wiki",
      from, to,
      wikiTarget: target,
      wikiResolved: resolveWikiLink(target) !== null,
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
            entries.push({ from: mk.from, to: mk.to, decoration: markHiddenAt(state, mk.from, mk.to, activeLine) });
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
          entries.push({ from: mk.from, to: mk.to, decoration: markHiddenAt(state, mk.from, mk.to, activeLine) });
        }
        break;
      }

      case "link": {
        for (const mk of b.markList ?? []) {
          entries.push({
            from: mk.from, to: mk.to,
            decoration: markHiddenAt(state, mk.from, mk.to, activeLine),
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
        w.blockFrom = b.from;
        w.blockTo = b.to;
        entries.push({ from: b.from, to: b.to, decoration: Decoration.replace({ widget: w, block: true }) });
        break;
      }

      case "table": {
        if (isOnActiveLine(state, b.from, b.to, activeLine)) break; // keep source editable
        const w = new TableWidget(b.tableRaw ?? "");
        w.blockFrom = b.from;
        w.blockTo = b.to;
        entries.push({ from: b.from, to: b.to, decoration: Decoration.replace({ widget: w, block: true }) });
        break;
      }

      case "task": {
        if (isOnActiveLine(state, b.from, b.to, activeLine)) break; // keep source editable
        entries.push({
          from: b.from, to: b.to,
          decoration: Decoration.replace({ widget: new TaskCheckboxWidget(b.checked ?? false), block: true }),
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

      case "frontmatter": {
        entries.push({
          from: b.from, to: b.to,
          decoration: Decoration.mark({ attributes: { class: "cm-frontmatter-bar" } }),
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

      // Task checkbox toggle
      if (target.tagName === "INPUT") {
        const label = target.closest(".cm-task-toggle");
        if (!label) return false;
        const pos = view.posAtDOM(target);
        const tree = syntaxTree(view.state);
        const node = tree.resolve(pos, -1);
        if (!node || (node.type.name !== "Task" && node.type.name !== "TaskMarker")) return false;
        let markerNode = node;
        if (node.type.name === "Task") {
          const cur = node.node.cursor();
          if (cur.firstChild()) {
            do {
              if (cur.type.name === "TaskMarker") {
                markerNode = cur.node;
                break;
              }
            } while (cur.nextSibling());
          }
        }
        const text = view.state.doc.sliceString(markerNode.from, markerNode.to);
        const newText = /^\[[xX]\]$/.test(text) ? "[ ]" : "[x]";
        view.dispatch({
          changes: { from: markerNode.from, to: markerNode.to, insert: newText },
        });
        return true;
      }

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
      }

      // Wiki links: Ctrl+click a resolved link opens the target note; clicking
      // an unresolved link creates it. A plain click on a resolved link leaves
      // the default cursor placement so the source stays editable.
      const wikilink = target.closest<HTMLElement>(".cm-wikilink");
      if (wikilink) {
        const ctx = view.state.facet(markdownContextFacet)[0];
        if (!ctx) return false;
        const raw = wikilink.dataset.wikiTarget ?? "";
        const targetPath = resolveWikiLink(raw);
        if (targetPath) {
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            void openWikiLink(ctx, targetPath);
            return true;
          }
          return false;
        }
        event.preventDefault();
        void createAndOpenWikiNote(ctx, raw);
        return true;
      }

      // Source badge on image/math widgets: flip that block to source. The
      // block's range is stored on the badge as data attributes (set by
      // appendSourceBadge) because math blocks have no Lezer node to resolve.
      const badge = target.closest<HTMLElement>(".cm-source-badge");
      if (badge) {
        const from = Number(badge.dataset.from);
        const to = Number(badge.dataset.to);
        if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
        view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
        return true;
      }

      return false;
    },
  },
});

export const LivePreviewPlugin = LivePlugin;

async function openWikiLink(ctx: MarkdownContext, path: string): Promise<void> {
  const { openNote } = await import("../lib/openNote");
  await openNote(ctx.vaultRoot, path);
}

/** Create a missing `[[target]]` note and open it. A target with a `/` is used
 *  as-is (vault-root-relative); a bare name is created next to the current doc
 *  (Obsidian default). */
async function createAndOpenWikiNote(ctx: MarkdownContext, raw: string): Promise<void> {
  const { createFile, readFile } = await import("../lib/ipc");
  const { useDocStore } = await import("../stores/docStore");
  const { useUiStore } = await import("../stores/uiStore");
  const { useVaultStore } = await import("../stores/vaultStore");
  const target = raw.split("|")[0].trim();
  if (!target) return;
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
    const content = await readFile(ctx.vaultRoot, newPath);
    const title = target.split("/").pop() ?? target;
    useDocStore.getState().openDoc(title, newPath);
    useDocStore.getState().setActiveContent(content);
    useUiStore.getState().addRecent(newPath);
  } catch {
    // creation failed — leave the editor unchanged
  }
}
