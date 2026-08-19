import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { Table, TaskList, Strikethrough } from "@lezer/markdown";
import { extractHeadings, moveHeadingBlock } from "../Outline";

function stateOf(doc: string): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [Table, TaskList, Strikethrough] })],
  });
  // CM6 parses markdown lazily in the background; block until the full tree is
  // ready so heading extraction never races the parser on slow machines.
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
}

describe("extractHeadings", () => {
  it("extracts ATX headings with levels", () => {
    const headings = extractHeadings(stateOf("# Title\n\n## Sub\n\n### Deep\n"));
    expect(headings).toEqual([
      { level: 1, text: "Title", from: 0 },
      { level: 2, text: "Sub", from: 9 },
      { level: 3, text: "Deep", from: 17 },
    ]);
  });

  it("strips the # marks from heading text", () => {
    const headings = extractHeadings(stateOf("##  Padded Title  \n"));
    expect(headings[0].text).toBe("Padded Title");
  });

  it("returns empty for a document with no headings", () => {
    expect(extractHeadings(stateOf("plain paragraph\n\n- list item\n"))).toEqual([]);
  });

  it("ignores YAML frontmatter (--- ... ---) at the top", () => {
    const doc = "---\nauthor: sinply\ncreated: 2022-03-12\n---\n\n# Real Title\n";
    const headings = extractHeadings(stateOf(doc));
    expect(headings.map((h) => h.text)).toEqual(["Real Title"]);
  });

  it("still finds headings after frontmatter", () => {
    const doc = "---\nauthor: x\n---\n\n## Section\n\n### Sub\n";
    const headings = extractHeadings(stateOf(doc));
    expect(headings.map((h) => h.text)).toEqual(["Section", "Sub"]);
  });
});

describe("moveHeadingBlock", () => {
  const apply = (state: EditorState, move: ReturnType<typeof moveHeadingBlock>) => {
    if (!move) return state.doc.toString();
    const afterDelete = state.update({
      changes: { from: move.delete.from, to: move.delete.to, insert: "" },
    });
    return afterDelete.state.update({
      changes: { from: move.insertAt, to: move.insertAt, insert: move.insert },
    }).state.doc.toString();
  };

  it("moves a same-level block after the target (drag down)", () => {
    const doc = "# A\n\n# B\n\n# C\n";
    const out = apply(stateOf(doc), moveHeadingBlock(stateOf(doc), 1, 2));
    expect(out).toBe("# A\n\n# C\n# B\n\n");
  });

  it("moves a block down one position (adjacent blocks)", () => {
    const doc = "# A\n\n# B\n\n# C\n";
    const out = apply(stateOf(doc), moveHeadingBlock(stateOf(doc), 0, 1));
    expect(out).toBe("# B\n\n# A\n\n# C\n");
  });

  it("moves a block up (target before source, position unchanged)", () => {
    const doc = "# A\n\n# B\n\n# C\n";
    // Move C after B -> no-op (C already follows B).
    const out = apply(stateOf(doc), moveHeadingBlock(stateOf(doc), 2, 1));
    expect(out).toBe(doc);
  });

  it("carries sub-content with a parent heading", () => {
    const doc = "# Top\n\nintro\n\n## Sub\n\nsub body\n\n# Other\n";
    // Move "Top" (with its Sub child) after "Other".
    const out = apply(stateOf(doc), moveHeadingBlock(stateOf(doc), 0, 2));
    expect(out).toContain("# Top\n\nintro\n\n## Sub\n\nsub body");
    expect(out.indexOf("# Other")).toBeLessThan(out.indexOf("# Top"));
  });

  it("returns null for same-index moves", () => {
    expect(moveHeadingBlock(stateOf("# A\n\n# B\n"), 0, 0)).toBeNull();
  });
});
