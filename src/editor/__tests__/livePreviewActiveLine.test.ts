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
});
