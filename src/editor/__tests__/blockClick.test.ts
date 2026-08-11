import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { createEditorState } from "../codemirror";
import { livePreviewField } from "../livePreview";

const DOC = "text before\n\n```js\nlet a = 1;\nlet b = 2;\nlet c = 3;\n```\n\nafter\n";

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

describe("block-click cursor placement (edit mode)", () => {
  it("renders the code block as a widget when the cursor is away", () => {
    const { view, parent } = mount();
    view.dispatch({ selection: { anchor: DOC.length } });
    const n = widgetCount(view.state);
    const block = parent.querySelector(".cm-codeblock");
    view.destroy();
    document.body.removeChild(parent);
    expect(n).toBe(1);
    expect(block).not.toBeNull();
  });

  it("clicking the block reveals source and places the cursor on the clicked line", () => {
    const { view, parent } = mount();
    view.dispatch({ selection: { anchor: DOC.length } }); // block rendered as widget
    const block = parent.querySelector(".cm-codeblock")! as HTMLElement;

    // Stub the block's rect so the handler's inner-line math is deterministic:
    // click 60px below the block top ≈ line 3 of a 20px/line block.
    const origRect = block.getBoundingClientRect;
    (block as any).getBoundingClientRect = () => ({ top: 0, height: 120 } as DOMRect);
    const clientY = 60; // 3 * 20 => inner line index 3 within the block text
    const ev = new MouseEvent("mousedown", { clientY, bubbles: true });
    ev.preventDefault = () => {}; // jsdom may not implement

    // Dispatch on the block itself (bubbles up to contentDOM → CM6 handler).
    const handled = block.dispatchEvent(ev);

    // Restore
    (block as any).getBoundingClientRect = origRect;

    // The block should now be revealed as source (widget gone) ...
    const after = widgetCount(view.state);
    // ... and the cursor should be on a line INSIDE the code body (lines 4-6),
    // not the block-start line (3).
    const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
    void handled;
    view.destroy();
    document.body.removeChild(parent);

    expect(after).toBe(0); // source revealed
    expect(cursorLine).toBeGreaterThanOrEqual(4);
    expect(cursorLine).toBeLessThanOrEqual(6);
  });
});
