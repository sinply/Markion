import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Table, TaskList, Strikethrough } from "@lezer/markdown";
import { extractHeadings } from "../Outline";

function stateOf(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [Table, TaskList, Strikethrough] })],
  });
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
});
