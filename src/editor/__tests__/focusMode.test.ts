import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { createEditorState, setFocusMode } from "../codemirror";

function mount(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = createEditorState(doc, () => {}, { onStateChange: () => {} });
  const view = new EditorView({ state, parent });
  void view.contentDOM.offsetWidth;
  return { view, parent };
}

describe("setFocusMode", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("adds an active-line highlight when enabled", () => {
    const { view, parent } = mount("line one\nline two\nline three\n");
    expect(parent.querySelector(".cm-activeLine")).toBeNull();

    setFocusMode(view, true);
    view.dispatch({ selection: { anchor: 4 } });
    const el = parent.querySelector(".cm-activeLine");
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe("line one");

    setFocusMode(view, false);
    expect(parent.querySelector(".cm-activeLine")).toBeNull();
    view.destroy();
    document.body.removeChild(parent);
  });

  it("keeps document content intact while toggling", () => {
    const { view, parent } = mount("hello world\n");
    setFocusMode(view, true);
    setFocusMode(view, false);
    view.dispatch({ changes: { from: 0, insert: "X" } });
    expect(view.state.doc.toString()).toBe("Xhello world\n");
    view.destroy();
    document.body.removeChild(parent);
  });
});
