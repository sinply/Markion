import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { createEditorState } from "../codemirror";
import { livePreviewField } from "../livePreview";

const CODE_DOC = "text before\n\n```js\nlet a = 1;\nlet b = 2;\nlet c = 3;\n```\n\nafter\n";
const TABLE_DOC = "text before\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nafter\n";

function mount(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = createEditorState(doc, () => {}, { onStateChange: () => {} });
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

describe("block click behavior after removing the source-flip interceptor", () => {
  it("renders the code block as a widget when the cursor is away", () => {
    const { view, parent } = mount(CODE_DOC);
    view.dispatch({ selection: { anchor: CODE_DOC.length } });
    expect(widgetCount(view.state)).toBe(1);
    view.destroy();
    document.body.removeChild(parent);
  });

  it("clicking a CODE block keeps it a widget (edit-in-place, no flip)", () => {
    const { view, parent } = mount(CODE_DOC);
    view.dispatch({ selection: { anchor: CODE_DOC.length } });
    const block = parent.querySelector(".cm-codeblock")! as HTMLElement;
    const ev = new MouseEvent("mousedown", { bubbles: true });
    block.dispatchEvent(ev);
    expect(widgetCount(view.state)).toBe(1); // stays rendered
    view.destroy();
    document.body.removeChild(parent);
  });

  it("moving the cursor into a TABLE still reveals source (CM6 default, no custom placement)", () => {
    const { view, parent } = mount(TABLE_DOC);
    view.dispatch({ selection: { anchor: TABLE_DOC.length } });
    // In a real browser, TableWidget.ignoreEvent is still false, so a mousedown
    // on the table falls through to CM6's default click handling: the cursor
    // moves into the block and the table flips to source. jsdom has no layout
    // engine (Range.getClientRects is unimplemented), so a coordinate-based
    // mousedown can't drive that default path here — it would throw and land the
    // cursor at the doc end. Simulate the CM6-default result (the cursor inside
    // the table block) and assert the flip; no custom "clicked inner line"
    // placement is involved anymore.
    const inTable = TABLE_DOC.indexOf("| 1 | 2 |") + 2;
    view.dispatch({ selection: { anchor: inTable } });
    expect(widgetCount(view.state)).toBe(0); // source revealed
    view.destroy();
    document.body.removeChild(parent);
  });
});
