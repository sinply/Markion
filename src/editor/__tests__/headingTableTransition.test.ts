import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Table, TaskList, Strikethrough, Superscript, Subscript } from "@lezer/markdown";
import { buildDecorations } from "../livePreview";

const DOC = `### 突发标题

| 列A | 列B |
|---|---|
| 1 | 2 |

结尾段落
`;

function stateAt(head: number): EditorState {
  return EditorState.create({
    doc: DOC,
    selection: { anchor: head },
    extensions: [
      markdown({ base: markdownLanguage, extensions: [Table, TaskList, Strikethrough, Superscript, Subscript] }),
      // minimal stand-ins for the app's fields are unnecessary: we call
      // buildDecorations directly with plain states.
    ],
  });
}

function classes(state: EditorState): string[] {
  const out: string[] = [];
  const decos = buildDecorations(state);
  decos.between(0, state.doc.length, (_f, _t, d) => {
    const c = d.spec.attributes?.class ?? d.spec.widget?.constructor?.name ?? "";
    out.push(c);
  });
  return out;
}

describe("heading next to table — cursor transitions", () => {
  it("cursor at END: heading hash hidden AND table widget present", () => {
    const cls = classes(stateAt(DOC.length));
    const text = DOC;
    void text;
    expect(cls.some((c) => c.includes("cm-heading"))).toBe(true);
    expect(cls.some((c) => c.includes("TableWidget"))).toBe(true);
    // No hidden-mark needed to check here; heading marks must be cm-hidden.
    expect(cls.filter((c) => c === "cm-hidden cm-mark").length).toBeGreaterThan(0);
  });

  it("cursor INSIDE the heading line: raw ### visible via active-line-mark", () => {
    const hashPos = DOC.indexOf("###") + 1;
    const cls = classes(stateAt(hashPos));
    expect(cls.some((c) => c.includes("cm-active-line-mark"))).toBe(true);
  });

  it("cursor back at END after visiting heading: no stale active-line-mark", () => {
    // simulate: visit heading, then move away (two separate builds)
    const hashPos = DOC.indexOf("###") + 1;
    classes(stateAt(hashPos)); // build for cursor-in-heading
    const clsAfter = classes(stateAt(DOC.length));
    expect(clsAfter.some((c) => c.includes("cm-active-line-mark"))).toBe(false);
    expect(clsAfter.some((c) => c.includes("TableWidget"))).toBe(true);
    expect(clsAfter.some((c) => c.includes("cm-heading"))).toBe(true);
  });

  it("no exception from overlapping decorations anywhere in the cycle", () => {
    expect(() => {
      classes(stateAt(0));
      classes(stateAt(DOC.indexOf("|")));
      classes(stateAt(DOC.length));
      classes(stateAt(DOC.indexOf("突发") + 1));
    }).not.toThrow();
  });
});
