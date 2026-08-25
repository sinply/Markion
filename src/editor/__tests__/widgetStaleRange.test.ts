import { describe, it, expect, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { createEditorState } from "../codemirror";
import { CodeBlockWidget } from "../widgets";

/** Repro for a widget-position staleness class of bug:
 *  the widget's DOM is reused across transactions when eq() matches on
 *  content alone, but the widget instance (holding blockFrom/blockTo) is
 *  rebuilt on EVERY transaction (livePreviewField.update rebuilds the whole
 *  DecorationSet). Event handlers registered in toDOM close over the OLD
 *  instance's positions, so after text is inserted ABOVE the widget, an
 *  edit+blur commits the change at the stale range. */

function mount(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = createEditorState(doc, () => {}, { onStateChange: () => {} });
  const view = new EditorView({ state, parent });
  void view.contentDOM.offsetWidth;
  // Move the cursor off the block so the widget renders.
  view.dispatch({ selection: { anchor: doc.length } });
  return { view, parent };
}

describe("CodeBlockWidget commit range survives edits above the block", () => {
  it("commits at the current (shifted) position after inserting text above", () => {
    const DOC = "para\n\n```js\nlet a = 1;\n```\n\nafter\n";
    const { view, parent } = mount(DOC);
    const ce = parent.querySelector(".cm-codeblock [contenteditable]") as HTMLElement;
    expect(ce).not.toBeNull();

    // Insert a paragraph ABOVE the code block (a normal doc edit while the
    // widget is rendered).
    const blockStart = DOC.indexOf("```");
    view.dispatch({
      changes: { from: 0, to: 0, insert: "# Title\n\n" },
    });
    // The widget DOM is reused (code content unchanged); only the widget
    // INSTANCE is rebuilt with shifted positions.

    // Now edit the code block content and blur — this must commit at the
    // SHIFTED range (which now starts at blockStart + 10).
    const ce2 = parent.querySelector(".cm-codeblock [contenteditable]") as HTMLElement;
    ce2.textContent = "let b = 2;";
    ce2.dispatchEvent(new Event("blur"));

    const docText = view.state.doc.toString();
    // The committed text must replace exactly the fenced block, leaving the
    // "# Title" paragraph and the "after" text intact and uncorrupted.
    expect(docText).toBe("# Title\n\npara\n\n```js\nlet b = 2;\n```\n\nafter\n");
    expect(docText).not.toContain("let a = 1;");
    view.destroy();
    document.body.removeChild(parent);
  });
});
