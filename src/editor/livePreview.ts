import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, EditorState } from "@codemirror/state";
import { CodeBlockWidget, TableWidget, TaskCheckboxWidget } from "./widgets";

/** Pure function: build decorations for the given CM6 state's syntax tree. */
export function buildDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(state);

  tree.iterate({
    enter(node) {
      const { name: type } = node.type;

      // --- Inline: StrongEmphasis (**) / Emphasis (*) ---
      if (type === "StrongEmphasis" || type === "Emphasis") {
        const cur = node.node.cursor();
        if (cur.firstChild()) {
          do {
            if (cur.type.name === "EmphasisMark") {
              builder.add(
                cur.from, cur.to,
                Decoration.mark({
                  attributes: { class: "cm-hidden", style: "opacity:0.25" },
                }),
              );
            }
          } while (cur.nextSibling());
        }
        return false;
      }

      // --- Inline: CodeMark (backticks) ---
      if (type === "InlineCode") {
        const cur = node.node.cursor();
        if (cur.firstChild()) {
          do {
            if (cur.type.name === "CodeMark") {
              builder.add(
                cur.from, cur.to,
                Decoration.mark({
                  attributes: { class: "cm-hidden cm-code-marker", style: "opacity:0.25" },
                }),
              );
            }
          } while (cur.nextSibling());
        }
        builder.add(
          node.from, node.to,
          Decoration.mark({
            attributes: { class: "cm-inline-code" },
          }),
        );
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
              builder.add(
                cur.from, cur.to,
                Decoration.mark({
                  attributes: { class: "cm-hidden cm-link-marker", style: "opacity:0.2" },
                }),
              );
            }
            if (cur.type.name === "LinkText") {
              linkTextFrom = cur.from;
              linkTextTo = cur.to;
            }
          } while (cur.nextSibling());
        }
        if (linkTextFrom >= 0) {
          builder.add(
            linkTextFrom, linkTextTo,
            Decoration.mark({
              attributes: { class: "cm-link", style: "text-decoration:underline;cursor:pointer" },
            }),
          );
        }
        return false;
      }

      // --- Block: FencedCode ---
      if (type === "FencedCode" || type === "CodeBlock") {
        const text = state.doc.sliceString(node.from, node.to);
        const lines = text.split("\n");
        const infoLine = lines[0]?.replace(/^```/, "").trim() ?? "";
        const codeLines = lines.slice(1, -1).join("\n");
        // strip trailing ```
        const cleanCode = codeLines.replace(/\n```\s*$/, "");
        builder.add(
          node.from, node.to,
          Decoration.replace({ widget: new CodeBlockWidget(cleanCode, infoLine) }),
        );
        return false;
      }

      // --- Block: Table ---
      if (type === "Table") {
        const raw = state.doc.sliceString(node.from, node.to);
        builder.add(
          node.from, node.to,
          Decoration.replace({ widget: new TableWidget(raw) }),
        );
        return false;
      }

      // --- Block: TaskMarker ([ ] / [x]) ---
      if (type === "TaskMarker") {
        const text = state.doc.sliceString(node.from, node.to);
        const checked = /^\[[xX]\]$/.test(text);
        builder.add(
          node.from, node.to,
          Decoration.replace({ widget: new TaskCheckboxWidget(checked) }),
        );
        return false;
      }

      // --- Block: HTMLBlock --- hide meta
      if (type === "HTMLBlock") {
        return false;
      }
    },
  });

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
      if (!node || node.type.name !== "TaskMarker") return false;
      const text = view.state.doc.sliceString(node.from, node.to);
      const newText = /^\[[xX]\]$/.test(text) ? "[ ]" : "[x]";
      view.dispatch({
        changes: { from: node.from, to: node.to, insert: newText },
      });
      return true;
    },
  },
});

export const LivePreviewPlugin = LivePlugin;
