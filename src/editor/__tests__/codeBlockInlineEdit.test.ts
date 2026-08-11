import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { createEditorState } from "../codemirror";
import { livePreviewField } from "../livePreview";
import { CodeBlockWidget } from "../widgets";

const DOC = "before\n\n```js\nlet a = 1;\nlet b = 2;\n```\n\nafter\n";

function mount() {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = createEditorState(DOC, () => {}, { onStateChange: () => {} });
  const view = new EditorView({ state, parent });
  void view.contentDOM.offsetWidth;
  return { view, parent };
}

function widgetCount(state: ReturnType<typeof createEditorState>): number {
  const it = state.field(livePreviewField).iter();
  let n = 0;
  while (it.value) { if (it.value.spec?.widget) n++; it.next(); }
  return n;
}

describe("CodeBlockWidget edit-in-place", () => {
  it("renders the code block as a contenteditable when cursor is away", () => {
    const { view, parent } = mount();
    view.dispatch({ selection: { anchor: DOC.length } });
    const ce = parent.querySelector(".cm-codeblock [contenteditable]");
    expect(ce).not.toBeNull();
    view.destroy();
    document.body.removeChild(parent);
  });

  it("keeps the code block rendered (widget) even when clicked", () => {
    const { view, parent } = mount();
    view.dispatch({ selection: { anchor: DOC.length } });
    // The block should stay a widget (not flip to source) on click.
    const block = parent.querySelector(".cm-codeblock")! as HTMLElement;
    const ev = new MouseEvent("mousedown", { bubbles: true });
    block.dispatchEvent(ev);
    expect(widgetCount(view.state)).toBe(1);
    view.destroy();
    document.body.removeChild(parent);
  });
});

describe("CodeBlockWidget commit-on-blur", () => {
  it("commits edited code back to the document on blur", () => {
    const { view, parent } = mount();
    view.dispatch({ selection: { anchor: DOC.length } });
    const ce = parent.querySelector(".cm-codeblock [contenteditable]") as HTMLElement;
    ce.textContent = "let a = 99;\nlet b = 2;";
    ce.dispatchEvent(new Event("blur"));
    const docText = view.state.doc.toString();
    expect(docText).toContain("let a = 99;");
    expect(docText).not.toContain("let a = 1;");
    view.destroy();
    document.body.removeChild(parent);
  });
});
