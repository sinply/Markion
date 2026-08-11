import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { createEditorState } from "../codemirror";

const IMG_DOC = "![alt](img.png)\n\nsecond line\n";
const MATH_DOC = "$$\nE = mc^2\n$$\n\nsecond line\n";

function mount(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = createEditorState(doc, () => {}, { onStateChange: () => {} });
  const view = new EditorView({ state, parent });
  void view.contentDOM.offsetWidth;
  return { view, parent };
}

describe("image/math source badge", () => {
  it("image widget renders a source badge", () => {
    const { view, parent } = mount(IMG_DOC);
    view.dispatch({ selection: { anchor: IMG_DOC.length } });
    const badge = parent.querySelector(".cm-source-badge");
    expect(badge).not.toBeNull();
    view.destroy();
    document.body.removeChild(parent);
  });

  it("math block widget renders a source badge", () => {
    const { view, parent } = mount(MATH_DOC);
    view.dispatch({ selection: { anchor: MATH_DOC.length } });
    const badge = parent.querySelector(".cm-source-badge");
    expect(badge).not.toBeNull();
    view.destroy();
    document.body.removeChild(parent);
  });

  it("clicking a math badge reveals the source", () => {
    const { view, parent } = mount(MATH_DOC);
    view.dispatch({ selection: { anchor: MATH_DOC.length } });
    const badge = parent.querySelector(".cm-math-block .cm-source-badge") as HTMLElement;
    expect(badge).not.toBeNull();
    badge.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // math block should now be revealed as source (widget gone)
    expect(parent.querySelector(".cm-math-block")).toBeNull();
    view.destroy();
    document.body.removeChild(parent);
  });

  it("math badge survives the async katex render", async () => {
    const { view, parent } = mount(MATH_DOC);
    view.dispatch({ selection: { anchor: MATH_DOC.length } });
    // Let the lazy katex import + renderToString complete; the badge must be
    // re-attached after katex replaces the block's innerHTML.
    await new Promise<void>((r) => setTimeout(r, 50));
    const badge = parent.querySelector(".cm-math-block .cm-source-badge");
    expect(badge).not.toBeNull();
    view.destroy();
    document.body.removeChild(parent);
  });
});
