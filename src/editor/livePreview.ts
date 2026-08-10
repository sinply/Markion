import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, EditorState, StateEffect, StateField } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CodeBlockWidget, TableWidget, TaskCheckboxWidget, ImageWidget, MathBlockWidget, FrontmatterWidget, PreviewWidget, parseFrontmatter } from "./widgets";

interface DecoEntry {
  from: number;
  to: number;
  decoration: Decoration;
}

const setDecorations = StateEffect.define<DecorationSet>();

/** StateField holding live-preview decorations, provided via
 *  EditorView.decorations.from(field) so line-spanning block widgets are allowed
 *  (plugin-provided decorations cannot replace line breaks).
 */
export const livePreviewField = StateField.define<DecorationSet>({
  create(state: EditorState) {
    return buildDecorations(state);
  },
  update(decos: DecorationSet, tr) {
    decos = decos.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setDecorations)) {
        decos = e.value;
      }
    }
    return decos;
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
              entries.push({ from: cur.from, to: cur.to, decoration: hiddenMark() });
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
              entries.push({
                from: cur.from, to: cur.to,
                decoration: Decoration.mark({ attributes: { class: "cm-hidden cm-code-marker" } }),
              });
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
        const { src, alt } = imageSrcAltFromNode(state, node.node);
        entries.push({
          from: node.from, to: node.to,
          decoration: Decoration.replace({ widget: new ImageWidget(src, alt) }),
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
          const { src, alt } = imageSrcAltFromNode(state, imgChild.node);
          entries.push({
            from: imgChild.from, to: imgChild.to,
            decoration: Decoration.replace({ widget: new ImageWidget(src, alt) }),
          });
          for (const c of children) {
            if (c.name === "LinkMark" && (c.from < imgChild.from || c.to > imgChild.to)) {
              entries.push({ from: c.from, to: c.to, decoration: hiddenMark() });
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
              entries.push({ from: cur.from, to: cur.to, decoration: hiddenMark() });
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

      // --- Blockquote ---
      if (type === "Blockquote") {
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

      // --- Blockquote mark (>) ---
      if (type === "QuoteMark") {
        entries.push({ from: node.from, to: node.to, decoration: hiddenMark() });
        return false;
      }

      // --- List bullet/number marker ---
      if (type === "ListMark") {
        entries.push({ from: node.from, to: node.to, decoration: hiddenMark() });
        return false;
      }

      // --- Block: FencedCode ---
      if (type === "FencedCode" || type === "CodeBlock") {
        const text = state.doc.sliceString(node.from, node.to);
        const lines = text.split("\n");
        const infoLine = lines[0]?.replace(/^```/, "").trim() ?? "";
        const codeLines = lines.slice(1, -1).join("\n");
        entries.push({
          from: node.from, to: node.to,
          decoration: Decoration.replace({ widget: new CodeBlockWidget(codeLines, infoLine), block: true }),
        });
        return false;
      }

      // --- Block: Table (GFM) ---
      if (type === "Table") {
        const raw = state.doc.sliceString(node.from, node.to);
        entries.push({
          from: node.from, to: node.to,
          decoration: Decoration.replace({ widget: new TableWidget(raw), block: true }),
        });
        return false;
      }

      // --- Block: Task / TaskMarker (GFM) ---
      if (type === "Task" || type === "TaskMarker") {
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

  // --- YAML frontmatter: `---...---` at the very start of the doc becomes a
  //     Properties panel (Obsidian-style). Lezer sees it as HorizontalRule +
  //     SetextHeading, so scan the raw text first and take the doc-leading block.
  const docText = state.doc.toString();
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(docText);
  if (fmMatch) {
    const props = parseFrontmatter(fmMatch[1]);
    if (props.length > 0) {
      entries.push({
        from: 0,
        to: fmMatch[0].length,
        decoration: Decoration.replace({ widget: new FrontmatterWidget(props), block: true }),
      });
    }
  }

  // --- Block math: $$...$$ (Lezer markdown has no math nodes; scan the doc) ---
  const mathRe = /\$\$([\s\S]+?)\$\$/g;
  let m: RegExpExecArray | null;
  while ((m = mathRe.exec(docText)) !== null) {
    entries.push({
      from: m.index,
      to: m.index + m[0].length,
      decoration: Decoration.replace({ widget: new MathBlockWidget(m[1].trim()), block: true }),
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
    // Initial decorations are built by the StateField's `create`.
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      update.view.dispatch({
        effects: setDecorations.of(buildDecorations(update.state)),
      });
    }
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
      return false;
    },
  },
});

export const LivePreviewPlugin = LivePlugin;
