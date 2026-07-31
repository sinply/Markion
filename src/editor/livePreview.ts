import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, EditorState } from "@codemirror/state";
import { CodeBlockWidget, TableWidget, TaskCheckboxWidget } from "./widgets";

interface DecoEntry {
  from: number;
  to: number;
  decoration: Decoration;
}

/** Pure function: collect then sort decorations to avoid RangeSet ordering errors. */
export function buildDecorations(state: EditorState): DecorationSet {
  const entries: DecoEntry[] = [];
  const tree = syntaxTree(state);

  tree.iterate({
    enter(node) {
      const { name: type } = node.type;

      // --- Inline: Emphasis + StrongEmphasis ---
      if (type === "Emphasis" || type === "StrongEmphasis") {
        const cur = node.node.cursor();
        if (cur.firstChild()) {
          do {
            if (cur.type.name === "EmphasisMark") {
              entries.push({
                from: cur.from, to: cur.to,
                decoration: Decoration.mark({
                  attributes: { class: "cm-hidden cm-mark", style: "opacity:0.25" },
                }),
              });
            }
          } while (cur.nextSibling());
        }
        return false;
      }

      // --- Inline: InlineCode ---
      if (type === "InlineCode") {
        entries.push({
          from: node.from, to: node.to,
          decoration: Decoration.mark({ attributes: { class: "cm-inline-code" } }),
        });
        const cur = node.node.cursor();
        if (cur.firstChild()) {
          do {
            if (cur.type.name === "CodeMark") {
              entries.push({
                from: cur.from, to: cur.to,
                decoration: Decoration.mark({
                  attributes: { class: "cm-hidden cm-code-marker", style: "opacity:0.25" },
                }),
              });
            }
          } while (cur.nextSibling());
        }
        return false;
      }

      // --- Inline: Link ---
      if (type === "Link") {
        let linkTextFrom = -1;
        let linkTextTo = -1;
        const cur = node.node.cursor();
        if (cur.firstChild()) {
          do {
            if (cur.type.name === "LinkMark") {
              entries.push({
                from: cur.from, to: cur.to,
                decoration: Decoration.mark({
                  attributes: { class: "cm-hidden cm-link-marker", style: "opacity:0.2" },
                }),
              });
            }
            if (cur.type.name === "LinkText") {
              linkTextFrom = cur.from;
              linkTextTo = cur.to;
            }
          } while (cur.nextSibling());
        }
        if (linkTextFrom >= 0) {
          entries.push({
            from: linkTextFrom, to: linkTextTo,
            decoration: Decoration.mark({
              attributes: { class: "cm-link", style: "text-decoration:underline;cursor:pointer" },
            }),
          });
        }
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
          decoration: Decoration.replace({ widget: new CodeBlockWidget(codeLines, infoLine) }),
        });
        return false;
      }

      // --- Block: Table (GFM) ---
      if (type === "Table") {
        const raw = state.doc.sliceString(node.from, node.to);
        entries.push({
          from: node.from, to: node.to,
          decoration: Decoration.replace({ widget: new TableWidget(raw) }),
        });
        return false;
      }

      // --- Block: Task (list items with [ ] or [x]) ---
      if (type === "Task" || type === "TaskMarker") {
        const text = state.doc.sliceString(node.from, node.to);
        // For TaskMarker, the text is "[ ]" or "[x]"
        // For Task, we need to find the marker child
        if (type === "TaskMarker") {
          const checked = /^\[[xX]\]$/.test(text);
          entries.push({
            from: node.from, to: node.to,
            decoration: Decoration.replace({ widget: new TaskCheckboxWidget(checked) }),
          });
        } else {
          // Task: find the TaskMarker child
          const cur = node.node.cursor();
          if (cur.firstChild()) {
            do {
              if (cur.type.name === "TaskMarker") {
                const mt = state.doc.sliceString(cur.from, cur.to);
                const checked = /^\[[xX]\]$/.test(mt);
                entries.push({
                  from: cur.from, to: cur.to,
                  decoration: Decoration.replace({ widget: new TaskCheckboxWidget(checked) }),
                });
              }
            } while (cur.nextSibling());
          }
        }
        return false;
      }

      // --- Block: irrelevant types ---
      if (type === "HTMLBlock" || type === "Document" || type === "Paragraph") {
        // Skip — not decoration-worthy
      }
    },
  });

  // Sort by `from` to satisfy RangeSet ordering requirement
  entries.sort((a, b) => a.from - b.from || a.to - b.to);

  const builder = new RangeSetBuilder<Decoration>();
  for (const e of entries) {
    builder.add(e.from, e.to, e.decoration);
  }
  return builder.finish();
}

// ---- ViewPlugin ----

let LivePlugin = class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view.state);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildDecorations(update.state);
    }
  }
};

export const livePreviewExtension = ViewPlugin.fromClass(LivePlugin, {
  decorations: (v) => v.decorations,
  eventHandlers: {
    click(event, view) {
      const target = event.target as HTMLElement;
      if (target.tagName !== "INPUT") return false;
      const label = target.closest(".cm-task-toggle");
      if (!label) return false;
      const pos = view.posAtDOM(target);
      const tree = syntaxTree(view.state);
      const node = tree.resolve(pos, -1);
      if (!node || (node.type.name !== "Task" && node.type.name !== "TaskMarker")) return false;
      // find the TaskMarker within Task
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
    },
  },
});

export const LivePreviewPlugin = LivePlugin;
