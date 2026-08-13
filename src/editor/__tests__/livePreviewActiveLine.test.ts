import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Table, TaskList, Strikethrough } from "@lezer/markdown";
import { buildDecorations } from "../livePreview";

function stateOf(doc: string, cursorPos: number): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: cursorPos },
    extensions: [markdown({ base: markdownLanguage, extensions: [Table, TaskList, Strikethrough] })],
  });
}

function countClass(decos: ReturnType<typeof buildDecorations>, cls: string): number {
  const iter = decos.iter();
  let n = 0;
  while (iter.value) {
    const c = iter.value.spec?.attributes?.class || "";
    if (c.includes(cls)) n++;
    iter.next();
  }
  return n;
}

describe("buildDecorations active line", () => {
  const doc = "**bold line**\n\n**another bold**\n";

  it("hides bold markers on non-active lines", () => {
    // cursor on line 3 (the second bold), so the first bold's markers hide fully
    const pos = doc.indexOf("**another bold**");
    const decos = buildDecorations(stateOf(doc, pos));
    // 2 markers on the non-active line are fully hidden; 2 on active line are faint
    expect(countClass(decos, "cm-hidden cm-mark")).toBe(2);
    expect(countClass(decos, "cm-active-line-mark")).toBe(2);
  });

  it("shows markers faintly on the active line", () => {
    // cursor on line 1 (first bold)
    const decos = buildDecorations(stateOf(doc, 1));
    expect(countClass(decos, "cm-active-line-mark")).toBe(2);
    expect(countClass(decos, "cm-hidden cm-mark")).toBe(2);
  });

  it("reuses the exact DecorationSet when the cursor moves within the same line", () => {
    // Same EditorState + same active line → cached set, no rebuild.
    const state = stateOf(doc, 1);
    const a = buildDecorations(state);
    const b = buildDecorations(state);
    expect(b).toBe(a);
  });

  it("reuses the cached scan when the cursor moves to another line", () => {
    // Two different active lines sharing the same document: the scan must be
    // reused (blocks identical) while the decide pass flips the active-line
    // marks. (EditorState.update returns a Transaction; `.state` is the new
    // EditorState.)
    const state = stateOf(doc, 1);
    const line1 = buildDecorations(state);
    const moved = state.update({ selection: { anchor: doc.indexOf("**another bold**") } }).state;
    const line3 = buildDecorations(moved);
    // Line 3 becomes active: the second bold's markers go faint...
    expect(countClass(line3, "cm-active-line-mark")).toBe(2);
    // ...and the first bold's markers hide fully again.
    expect(countClass(line3, "cm-hidden cm-mark")).toBe(2);
    expect(line3).not.toBe(line1);
  });

  it("rescans after the document changes", () => {
    const state = stateOf("# Title\n", 0);
    buildDecorations(state);
    const changed = state.update({ changes: { from: 0, insert: "new text\n" } }).state;
    // The cached set was keyed to the old doc; the new doc must rescan.
    const decos = buildDecorations(changed);
    expect(countClass(decos, "cm-heading")).toBe(1);
  });

  it("keeps widgets on non-active lines after selection moves", () => {
    // Selection moves off a code block → the widget must reappear from the
    // cached scan without a full rebuild.
    const text = "```js\nlet x = 1;\n```\n\nplain\n";
    const state = stateOf(text, 0); // cursor inside the code block: no widget
    const inBlock = buildDecorations(state);
    expect(widgetKinds(inBlock)).toEqual([]);
    const moved = state.update({ selection: { anchor: text.indexOf("plain") } }).state;
    const after = buildDecorations(moved);
    expect(widgetKinds(after)).toEqual(["code"]);
  });
});

function widgetKinds(decos: ReturnType<typeof buildDecorations>): string[] {
  const kinds: string[] = [];
  const iter = decos.iter();
  while (iter.value) {
    const w = iter.value.spec?.widget as { constructor?: { name?: string } } | undefined;
    const name = w?.constructor?.name ?? "";
    if (name === "CodeBlockWidget") kinds.push("code");
    else if (name === "TableWidget") kinds.push("table");
    else if (name === "TaskCheckboxWidget") kinds.push("task");
    else if (name === "ImageWidget") kinds.push("image");
    else if (name === "WikiLinkWidget") kinds.push("wiki");
    iter.next();
  }
  return kinds;
}
