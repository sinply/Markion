import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, EditorState, StateField } from "@codemirror/state";
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

/** Pure function: build decorations from the Lezer syntax tree. */
export function buildDecorations(state: EditorState): DecorationSet {
  const activeLine = activeLineOf(state);
  const entries: DecoEntry[] = [];
  const tree = syntaxTree(state);

  tree.iterate({
    enter(node) {
      const { name: type } = node.type;

      // --- Inline: Emphasis + StrongEmphasis (hide markers, style content) ---
      if (type === "Emphasis" || type === "StrongEmphasis") {
        const cur = node.node.cursor();
        if (cur.firstChild()) {
          do {
            if (cur.type.name === "EmphasisMark") {
              entries.push({ from: cur.from, to: cur.to, decoration: markHiddenAt(state, cur.from, cur.to, activeLine) });
            }
          } while (cur.nextSibling());
        }
        const style = type === "StrongEmphasis" ? "font-weight:700" : "font-style:italic";
        entries.push({
          from: node.from, to: node.to,
          decoration: Decoration.mark({ attributes: { class: "cm-emphasis", style } }),
        });
        return false;
      }

      // --- Inline: code ---
      if (type === "InlineCode") {
        // Push markers FIRST (shorter ranges) so the whole-span inline-code
        // mark (same `from`) doesn't collide with them during RangeSet build.
        const cur = node.node.cursor();
        if (cur.firstChild()) {
          do {
            if (cur.type.name === "CodeMark") {
              entries.push({ from: cur.from, to: cur.to, decoration: markHiddenAt(state, cur.from, cur.to, activeLine) });
            }
          } while (cur.nextSibling());
        }
        entries.push({
          from: node.from, to: node.to,
          decoration: Decoration.mark({ attributes: { class: "cm-inline-code" } }),
        });
        return false;
      }

      // --- Inline: images ---
      if (type === "Image") {
        if (isOnActiveLine(state, node.from, node.to, activeLine)) {
          return false; // keep source editable on the cursor line
        }
        const { src, alt } = imageSrcAltFromNode(state, node.node);
        const imageWidget = new ImageWidget(src, alt);
        imageWidget.from = node.from;
        imageWidget.to = node.to;
        entries.push({
          from: node.from, to: node.to,
          decoration: Decoration.replace({ widget: imageWidget }),
        });
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
          if (isOnActiveLine(state, imgChild.from, imgChild.to, activeLine)) {
            return false; // keep source editable on the cursor line
          }
          const { src, alt } = imageSrcAltFromNode(state, imgChild.node);
          const linkImageWidget = new ImageWidget(src, alt);
          linkImageWidget.from = imgChild.from;
          linkImageWidget.to = imgChild.to;
          entries.push({
            from: imgChild.from, to: imgChild.to,
            decoration: Decoration.replace({ widget: linkImageWidget }),
          });
          for (const c of children) {
            if (c.name === "LinkMark" && (c.from < imgChild.from || c.to > imgChild.to)) {
              entries.push({ from: c.from, to: c.to, decoration: markHiddenAt(state, c.from, c.to, activeLine) });
            }
          }
          return false;
        }

        for (const c of children) {
          if (c.name === "LinkMark") {
            entries.push({
              from: c.from, to: c.to,
              decoration: Decoration.mark({ attributes: { class: "cm-hidden cm-link-marker" } }),
            });
          }
        }
        // Link text = content after the opening [ bracket up to the URL.
        // GFM parses links as: LinkMark[ [, LinkMark[ ], LinkMark[(, URL, LinkMark[)
        // with the visible text as a raw range between from+1 and the URL.
        const doc = state.doc.toString();
        const rest = doc.slice(node.from + 1, node.to);
        const urlIdx = rest.indexOf("](");
        if (urlIdx >= 0) {
          const textFrom = node.from + 1;
          const textTo = node.from + 1 + urlIdx;
          entries.push({
            from: textFrom, to: textTo,
            decoration: Decoration.mark({
              attributes: { class: "cm-link", style: "color:#0366d6;text-decoration:underline;cursor:pointer" },
            }),
          });
        }
        return false;
      }

      // --- Headings (ATXHeading1..6, SetextHeading1/2): hide #, enlarge content ---
      if (type.startsWith("ATXHeading") || type.startsWith("SetextHeading")) {
        const m = type.match(/(\d)$/);
        const level = m ? Math.min(parseInt(m[1], 10), 6) : 1;
        const sizes = ["1.8em", "1.5em", "1.3em", "1.15em", "1em", "0.9em"];
        // Hide the # marks first (shorter ranges) to avoid same-from collision
        const cur = node.node.cursor();
        if (cur.firstChild()) {
          do {
            if (cur.type.name === "HeaderMark") {
              entries.push({ from: cur.from, to: cur.to, decoration: markHiddenAt(state, cur.from, cur.to, activeLine) });
            }
          } while (cur.nextSibling());
        }
        entries.push({
          from: node.from, to: node.to,
          decoration: Decoration.mark({
            attributes: {
              class: "cm-heading",
              style: `font-size:${sizes[level - 1]};font-weight:600;`,
            },
          }),
        });
        return false;
      }

      // --- Blockquote: hide the `>` mark(s), then style the content ---
      if (type === "Blockquote") {
        const cur = node.node.cursor();
        if (cur.firstChild()) {
          do {
            if (cur.type.name === "QuoteMark") {
              entries.push({ from: cur.from, to: cur.to, decoration: markHiddenAt(state, cur.from, cur.to, activeLine) });
            }
          } while (cur.nextSibling());
        }
        entries.push({
          from: node.from, to: node.to,
          decoration: Decoration.mark({
            attributes: {
              class: "cm-blockquote",
              style: "border-left:3px solid #dfe2e5;padding-left:12px;color:#6a737d;",
            },
          }),
        });
        return false;
      }

      // --- List bullet/number marker ---
      if (type === "ListMark") {
        entries.push({ from: node.from, to: node.to, decoration: markHiddenAt(state, node.from, node.to, activeLine) });
        return false;
      }

      // --- Block: FencedCode ---
      if (type === "FencedCode" || type === "CodeBlock") {
        if (isOnActiveLine(state, node.from, node.to, activeLine)) {
          return false; // keep source editable on the cursor line
        }
        const text = state.doc.sliceString(node.from, node.to);
        const lines = text.split("\n");
        const infoLine = lines[0]?.replace(/^```/, "").trim() ?? "";
        const codeLines = lines.slice(1, -1).join("\n");
        const codeWidget = new CodeBlockWidget(codeLines, infoLine);
        codeWidget.blockFrom = node.from;
        codeWidget.blockTo = node.to;
        entries.push({
          from: node.from, to: node.to,
          decoration: Decoration.replace({ widget: codeWidget, block: true }),
        });
        return false;
      }

      // --- Block: Table (GFM) ---
      if (type === "Table") {
        if (isOnActiveLine(state, node.from, node.to, activeLine)) {
          return false; // keep source editable on the cursor line
        }
        const raw = state.doc.sliceString(node.from, node.to);
        const tableWidget = new TableWidget(raw);
        tableWidget.blockFrom = node.from;
        tableWidget.blockTo = node.to;
        entries.push({
          from: node.from, to: node.to,
          decoration: Decoration.replace({ widget: tableWidget, block: true }),
        });
        return false;
      }

      // --- Block: Task / TaskMarker (GFM) ---
      if (type === "Task" || type === "TaskMarker") {
        if (isOnActiveLine(state, node.from, node.to, activeLine)) {
          return false; // keep source editable on the cursor line
        }
        const text = state.doc.sliceString(node.from, node.to);
        if (type === "TaskMarker") {
          const checked = /^\[[xX]\]$/.test(text);
          entries.push({
            from: node.from, to: node.to,
            decoration: Decoration.replace({ widget: new TaskCheckboxWidget(checked), block: true }),
          });
        } else {
          const cur = node.node.cursor();
          if (cur.firstChild()) {
            do {
              if (cur.type.name === "TaskMarker") {
                const mt = state.doc.sliceString(cur.from, cur.to);
                const checked = /^\[[xX]\]$/.test(mt);
                entries.push({
                  from: cur.from, to: cur.to,
                  decoration: Decoration.replace({ widget: new TaskCheckboxWidget(checked), block: true }),
                });
              }
            } while (cur.nextSibling());
          }
        }
        return false;
      }
    },
  });

  // YAML frontmatter: in edit mode keep it as editable source, but give it a
  // subtle background bar (not highlighted) so it reads as a distinct panel.
  const docText = state.doc.toString();
  const fmMatch = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(docText);
  if (fmMatch) {
    entries.push({
      from: 0,
      to: fmMatch[0].length,
      decoration: Decoration.mark({ attributes: { class: "cm-frontmatter-bar" } }),
    });
  }

  // --- Block math: $$...$$ (Lezer markdown has no math nodes; scan the doc) ---
  const mathRe = /\$\$([\s\S]+?)\$\$/g;
  let m: RegExpExecArray | null;
  while ((m = mathRe.exec(docText)) !== null) {
    if (isOnActiveLine(state, m.index, m.index + m[0].length, activeLine)) {
      continue; // keep source editable on the cursor line
    }
    const mathBlockWidget = new MathBlockWidget(m[1].trim());
    mathBlockWidget.from = m.index;
    mathBlockWidget.to = m.index + m[0].length;
    entries.push({
      from: m.index,
      to: m.index + m[0].length,
      decoration: Decoration.replace({ widget: mathBlockWidget, block: true }),
    });
  }

  // --- Inline math: $...$ (single dollar, not part of $$...$$) ---
  // A crude-but-robust scan: find `$` pairs on the same line, non-empty,
  // not preceded/followed by another `$`.
  const inlineMathRe = /(?<![\$\\])\$([^\$\n]+?)\$(?!\$)/g;
  let im: RegExpExecArray | null;
  while ((im = inlineMathRe.exec(docText)) !== null) {
    // Skip if this range overlaps an already-added block math range
    const overlapsBlock = entries.some(
      (e) => im!.index < e.to && im!.index + im![0].length > e.from && e.decoration.spec?.widget,
    );
    if (overlapsBlock) continue;
    if (isOnActiveLine(state, im.index, im.index + im[0].length, activeLine)) {
      continue; // keep source editable on the cursor line
    }
    const mathInlineWidget = new MathInlineWidget(im[1].trim());
    mathInlineWidget.from = im.index;
    mathInlineWidget.to = im.index + im[0].length;
    entries.push({
      from: im.index,
      to: im.index + im[0].length,
      decoration: Decoration.replace({ widget: mathInlineWidget }),
    });
  }

  // --- Inline: wikilinks [[name]] / [[path/name]] / [[name|alias]] ---
  const wikiRe = /\[\[([^\]\n]+)\]\]/g;
  let wm: RegExpExecArray | null;
  while ((wm = wikiRe.exec(docText)) !== null) {
    const from = wm.index;
    const to = from + wm[0].length;
    // Never render `[[` inside fenced or inline code — resolve the tree at the
    // match start and skip if any ancestor is a code node.
    let inCode = false;
    for (let cur: SyntaxNode | null = syntaxTree(state).resolve(from, -1); cur; cur = cur.parent) {
      const n = cur.type.name;
      if (n === "FencedCode" || n === "CodeBlock" || n === "InlineCode") {
        inCode = true;
        break;
      }
    }
    if (inCode) continue;
    if (isOnActiveLine(state, from, to, activeLine)) {
      continue; // keep source editable on the cursor line
    }
    const target = wm[1].trim();
    const wikiWidget = new WikiLinkWidget(target, resolveWikiLink(target) !== null);
    wikiWidget.from = from;
    wikiWidget.to = to;
    entries.push({
      from, to,
      decoration: Decoration.replace({ widget: wikiWidget }),
    });
  }

  entries.sort((a, b) => a.from - b.from || a.to - b.to);

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
  const { readFile } = await import("../lib/ipc");
  const { useDocStore } = await import("../stores/docStore");
  const { useUiStore } = await import("../stores/uiStore");
  try {
    const content = await readFile(ctx.vaultRoot, path);
    const title = path.split("/").pop() ?? path;
    useDocStore.getState().openDoc(title, path);
    useDocStore.getState().setActiveContent(content);
    useUiStore.getState().addRecent(path);
  } catch {
    // read failed — leave the editor as is
  }
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
