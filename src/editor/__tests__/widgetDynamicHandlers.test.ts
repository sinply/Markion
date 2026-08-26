import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { createEditorState } from "../codemirror";
import { CodeBlockWidget, TableWidget, TaskCheckboxWidget } from "../widgets";

/** Regression tests for the widget eq()/event-handler design tension.
 *
 *  All six interactive widget classes use CONTENT-ONLY eq(), so CM6 reuses
 *  the existing DOM (and its event handlers, which close over the ORIGINAL
 *  widget instance) even when an edit above moves the decoration range. The
 *  handlers must therefore resolve every document position DYNAMICALLY at
 *  event time (posAtDOM + syntax tree), never from construction-time fields.
 *
 *  Covers both bug classes:
 *  - stale-position jumps (badge click after insert above);
 *  - per-keystroke DOM churn (block widget DOM identity across edits above,
 *    which used to re-run mermaid.render / markdown-it on every keystroke).
 */

function mount(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = createEditorState(doc, () => {}, { onStateChange: () => {} });
  const view = new EditorView({ state, parent });
  void view.contentDOM.offsetWidth;
  // Move the cursor away from the blocks so they render as widgets.
  view.dispatch({ selection: { anchor: doc.length } });
  return { view, parent };
}

const INSERT_ABOVE = "# Title\n\n";

describe("source badge jumps to the live position", () => {
  it("image badge click after inserting text above lands at the shifted offset", () => {
    const DOC = "![alt](img.png)\n\nsecond line\n";
    const { view, parent } = mount(DOC);
    view.dispatch({ changes: { from: 0, to: 0, insert: INSERT_ABOVE } });

    const badge = parent.querySelector(".cm-source-badge") as HTMLElement;
    expect(badge).not.toBeNull();
    badge.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // The badge element position IS the jump target — resolved at event time,
    // so the head must land at the image token's NEW start, not the stale 0.
    expect(view.state.selection.main.head).toBe(DOC.indexOf("![alt") + INSERT_ABOVE.length);
    view.destroy();
    document.body.removeChild(parent);
  });

  it("math-block badge click after inserting text above reveals the math source", () => {
    const DOC = "$$\nE = mc^2\n$$\n\ntail\n";
    const { view, parent } = mount(DOC);
    view.dispatch({ changes: { from: 0, to: 0, insert: INSERT_ABOVE } });

    const badge = parent.querySelector(".cm-math-block .cm-source-badge") as HTMLElement;
    expect(badge).not.toBeNull();
    badge.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Cursor now sits on the math block's line -> active-line rule flips the
    // widget back to editable source.
    expect(parent.querySelector(".cm-math-block")).toBeNull();
    const headLine = view.state.doc.lineAt(view.state.selection.main.head);
    expect(headLine.text).toBe("$$");
    view.destroy();
    document.body.removeChild(parent);
  });
});

describe("widget DOM identity survives edits elsewhere (content-only eq)", () => {
  it("code block root DOM node is reused after a character is inserted above", () => {
    const DOC = "para\n\n```js\nlet a = 1;\n```\n\ntail\n";
    const { view, parent } = mount(DOC);
    const pre1 = parent.querySelector("pre.cm-codeblock");
    expect(pre1).not.toBeNull();

    view.dispatch({ changes: { from: 0, to: 0, insert: "x" } });

    const pre2 = parent.querySelector("pre.cm-codeblock");
    expect(pre2).not.toBeNull();
    expect(pre2).toBe(pre1); // same node — no destroy/rebuild churn
    view.destroy();
    document.body.removeChild(parent);
  });

  it("mermaid diagram stub DOM is reused (no mermaid re-render per keystroke)", () => {
    const DOC = "para\n\n```mermaid\ngraph TD\n A-->B\n```\n\ntail\n";
    const { view, parent } = mount(DOC);
    const m1 = parent.querySelector(".cm-mermaid");
    expect(m1).not.toBeNull();

    view.dispatch({ changes: { from: 0, to: 0, insert: "x" } });

    const m2 = parent.querySelector(".cm-mermaid");
    expect(m2).not.toBeNull();
    expect(m2).toBe(m1);
    view.destroy();
    document.body.removeChild(parent);
  });

  it("table widget root DOM node is reused after an edit above", () => {
    const DOC = "para\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\ntail\n";
    const { view, parent } = mount(DOC);
    const wrap1 = parent.querySelector(".cm-table-wrap");
    expect(wrap1).not.toBeNull();

    view.dispatch({ changes: { from: 0, to: 0, insert: "x" } });

    const wrap2 = parent.querySelector(".cm-table-wrap");
    expect(wrap2).not.toBeNull();
    expect(wrap2).toBe(wrap1);
    view.destroy();
    document.body.removeChild(parent);
  });

  it("eq compares content only for code/table/task widgets", () => {
    expect(new CodeBlockWidget("a", "js").eq(new CodeBlockWidget("a", "js"))).toBe(true);
    expect(new CodeBlockWidget("a", "js").eq(new CodeBlockWidget("b", "js"))).toBe(false);
    expect(new CodeBlockWidget("a", "js").eq(new CodeBlockWidget("a", "ts"))).toBe(false);

    const raw = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    expect(new TableWidget(raw).eq(new TableWidget(raw))).toBe(true);
    expect(new TableWidget(raw).eq(new TableWidget("| A | C |\n| --- | --- |\n| 1 | 2 |"))).toBe(false);

    expect(new TaskCheckboxWidget(true).eq(new TaskCheckboxWidget(true))).toBe(true);
    expect(new TaskCheckboxWidget(true).eq(new TaskCheckboxWidget(false))).toBe(false);
  });
});

describe("TableWidget toolbar keeps uncommitted cell edits", () => {
  it("＋ row merges typed cell text into the doc together with the new row", () => {
    const DOC = "| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter\n";
    const { view, parent } = mount(DOC);

    // Type into a cell programmatically (the input listener marks it edited,
    // exactly like real typing), then click ＋ row. The button preventDefaults
    // mousedown to keep CM6 focus, so NO blur fires — the transform itself
    // must merge the live cell state before serializing.
    const cell = parent.querySelector(".cm-table td[contenteditable]") as HTMLElement;
    expect(cell).not.toBeNull();
    cell.textContent = "typed";
    cell.dispatchEvent(new Event("input", { bubbles: true }));

    const addRow = parent.querySelector(".cm-table-btn") as HTMLButtonElement;
    expect(addRow.textContent).toContain("row");
    addRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(view.state.doc.toString()).toBe(
      "| A | B |\n| --- | --- |\n| typed | 2 |\n|  |  |\n\nafter\n",
    );
    view.destroy();
    document.body.removeChild(parent);
  });

  it("＋ col keeps the typed cell and appends the new column", () => {
    const DOC = "| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter\n";
    const { view, parent } = mount(DOC);

    const cell = parent.querySelector(".cm-table td[contenteditable]") as HTMLElement;
    cell.textContent = "typed";
    cell.dispatchEvent(new Event("input", { bubbles: true }));

    const buttons = parent.querySelectorAll<HTMLButtonElement>(".cm-table-btn");
    buttons[2].dispatchEvent(new MouseEvent("click", { bubbles: true })); // ＋ col

    const docText = view.state.doc.toString();
    expect(docText).toContain("| A | B |  |");
    expect(docText).toContain("| typed | 2 |  |");
    view.destroy();
    document.body.removeChild(parent);
  });

  it("table blur commits at the shifted range after an edit above", () => {
    const DOC = "para\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter\n";
    const { view, parent } = mount(DOC);
    view.dispatch({ changes: { from: 0, to: 0, insert: INSERT_ABOVE } });

    const cell = parent.querySelector(".cm-table td[contenteditable]") as HTMLElement;
    cell.textContent = "9";
    cell.dispatchEvent(new Event("input", { bubbles: true }));
    // blur does not bubble, but capture-phase listeners on ancestors still run.
    cell.dispatchEvent(new Event("blur"));

    expect(view.state.doc.toString()).toBe(
      INSERT_ABOVE + "para\n\n| A | B |\n| --- | --- |\n| 9 | 2 |\n\nafter\n",
    );
    view.destroy();
    document.body.removeChild(parent);
  });
});

describe("TaskCheckboxWidget resolves its marker dynamically", () => {
  it("toggling after inserting text above flips the correct [ ] marker", () => {
    const DOC = "- [ ] one\n- [ ] two\n\ntail\n";
    const { view, parent } = mount(DOC);
    view.dispatch({ changes: { from: 0, to: 0, insert: INSERT_ABOVE } });

    const boxes = parent.querySelectorAll<HTMLInputElement>(".cm-task-toggle input");
    expect(boxes.length).toBe(2);
    boxes[1].dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(view.state.doc.toString()).toBe(
      INSERT_ABOVE + "- [ ] one\n- [x] two\n\ntail\n",
    );
    view.destroy();
    document.body.removeChild(parent);
  });
});
