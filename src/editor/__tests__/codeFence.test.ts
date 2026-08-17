import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Table, TaskList, Strikethrough } from "@lezer/markdown";
import { buildDecorations } from "../livePreview";
import { CodeBlockWidget } from "../widgets";

function stateOfEnd(doc: string): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: doc.length },
    extensions: [markdown({ base: markdownLanguage, extensions: [Table, TaskList, Strikethrough] })],
  });
}

function codeWidgets(state: EditorState): CodeBlockWidget[] {
  const decos = buildDecorations(state);
  const out: CodeBlockWidget[] = [];
  decos.between(0, state.doc.length, (_f, _t, deco) => {
    const w = deco.spec.widget;
    if (w instanceof CodeBlockWidget) out.push(w);
  });
  return out;
}

describe("fenced code extraction", () => {
  it("extracts language and body from a standard scala block", () => {
    const state = stateOfEnd("```scala\nval x = 1\nval y = 2\n```\n");
    const [w] = codeWidgets(state);
    expect(w).toBeTruthy();
    expect(w.language).toBe("scala");
    expect(w.code).toBe("val x = 1\nval y = 2");
  });

  it("handles a 4-backtick fence (no stray backtick in the language)", () => {
    const state = stateOfEnd("````scala\nval x = 1\n````\n");
    const [w] = codeWidgets(state);
    expect(w).toBeTruthy();
    expect(w.language).toBe("scala");
    expect(w.code).toBe("val x = 1");
  });

  it("handles a blank line right after the fence", () => {
    const state = stateOfEnd("```scala\n\nval x = 1\n```\n");
    const [w] = codeWidgets(state);
    expect(w).toBeTruthy();
    expect(w.code).toBe("val x = 1"); // leading blank line trimmed
  });

  it("keeps the body of an unclosed fence (cursor outside the block)", () => {
    // An unclosed fence runs to EOF; with the cursor on the intro line the
    // block is not on the active line, so the widget is built.
    const state = EditorState.create({
      doc: "intro\n```scala\nval x = 1\nval y = 2",
      selection: { anchor: 2 },
      extensions: [markdown({ base: markdownLanguage, extensions: [Table, TaskList, Strikethrough] })],
    });
    const [w] = codeWidgets(state);
    expect(w).toBeTruthy();
    expect(w.code).toBe("val x = 1\nval y = 2");
  });

  it("keeps the body of an empty language fence", () => {
    const state = stateOfEnd("```\nplain code\n```\n");
    const [w] = codeWidgets(state);
    expect(w).toBeTruthy();
    expect(w.language).toBe("");
    expect(w.code).toBe("plain code");
  });
});

describe("code blocks containing markdown-ish tokens", () => {
  it("renders a block with $x$ and $$ tokens inside (no math overlap)", () => {
    const state = stateOfEnd("```scala\nval s = s\"$a$b\"\nval r = $$y$$\n```\n");
    const [w] = codeWidgets(state);
    expect(w).toBeTruthy();
    expect(w.language).toBe("scala");
    expect(w.code).toBe("val s = s\"$a$b\"\nval r = $$y$$");
  });

  it("renders a block with [[wikilink]]-looking content inside", () => {
    const state = stateOfEnd("```rust\nlet s = \"[[not-a-link]]\";\n```\n");
    const [w] = codeWidgets(state);
    expect(w).toBeTruthy();
    expect(w.code).toBe("let s = \"[[not-a-link]]\";");
  });

  it("still renders math outside code blocks", () => {
    const state = stateOfEnd("Text $x^2$ here\n```scala\nval a = $q$\n```\n");
    const decos = buildDecorations(state);
    const iter = decos.iter();
    let mathCount = 0;
    let codeCount = 0;
    while (iter.value) {
      const w = iter.value.spec.widget;
      if (w instanceof CodeBlockWidget) codeCount++;
      else if (w && w.constructor.name.includes("Math")) mathCount++;
      iter.next();
    }
    expect(codeCount).toBe(1);
    expect(mathCount).toBe(1); // only the outside one
  });
});
