import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { createEditorState } from "../codemirror";
import { livePreviewField } from "../livePreview";

const DOC = "```js\nlet x = 1;\n```\n\n![alt](img.png)\n\nrest\n";

function widgetClasses(state: ReturnType<typeof createEditorState>): string[] {
  const decos = state.field(livePreviewField);
  const out: string[] = [];
  const iter = decos.iter();
  while (iter.value) {
    const w = iter.value.spec?.widget;
    if (w) out.push(w.constructor.name);
    iter.next();
  }
  return out;
}

async function flush(frames = 3): Promise<void> {
  for (let i = 0; i < frames; i++) {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function setCursor(view: EditorView, pos: number): Promise<string[]> {
  view.dispatch({ selection: { anchor: pos } });
  await flush();
  return widgetClasses(view.state);
}

describe("cursor-line editing of code blocks and images (edit mode)", () => {
  it("cursor inside a code block shows editable source, not a widget", async () => {
    const state = createEditorState(DOC, () => {}, { onStateChange: () => {} });
    const view = new EditorView({ state, parent: document.body });
    const classes = await setCursor(view, DOC.indexOf("let x = 1;"));
    view.destroy();
    expect(classes).not.toContain("CodeBlockWidget");
  });

  it("cursor on an image line shows editable source, not a widget", async () => {
    const state = createEditorState(DOC, () => {}, { onStateChange: () => {} });
    const view = new EditorView({ state, parent: document.body });
    const classes = await setCursor(view, DOC.indexOf("![alt](img.png)"));
    view.destroy();
    expect(classes).not.toContain("ImageWidget");
  });

  it("cursor away from a code block / image renders them as widgets", async () => {
    const state = createEditorState(DOC, () => {}, { onStateChange: () => {} });
    const view = new EditorView({ state, parent: document.body });
    const classes = await setCursor(view, DOC.length);
    view.destroy();
    expect(classes).toContain("CodeBlockWidget");
    expect(classes).toContain("ImageWidget");
  });
});
