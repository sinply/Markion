import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { runMarkdownCommand } from "../commands";

function viewOf(doc: string, from: number, to = from): EditorView {
  const parent = document.createElement("div");
  const state = EditorState.create({
    doc,
    selection: { anchor: from, head: to },
  });
  return new EditorView({ state, parent });
}

describe("markdown commands", () => {
  it("bold wraps the selection", () => {
    const view = viewOf("hello world", 0, 5);
    runMarkdownCommand(view, "bold");
    expect(view.state.doc.toString()).toBe("**hello** world");
    view.destroy();
  });

  it("italic wraps the selection", () => {
    const view = viewOf("hi there", 3, 8);
    runMarkdownCommand(view, "italic");
    expect(view.state.doc.toString()).toBe("hi *there*");
    view.destroy();
  });

  it("italic inserts a placeholder at the cursor", () => {
    const view = viewOf("hi there", 3);
    runMarkdownCommand(view, "italic");
    expect(view.state.doc.toString()).toBe("hi *text*there");
    view.destroy();
  });

  it("strike wraps with ~~", () => {
    const view = viewOf("abc", 0, 3);
    runMarkdownCommand(view, "strike");
    expect(view.state.doc.toString()).toBe("~~abc~~");
    view.destroy();
  });

  it("heading1 prefixes the line", () => {
    const view = viewOf("title", 0);
    runMarkdownCommand(view, "heading1");
    expect(view.state.doc.toString()).toBe("# title");
    view.destroy();
  });

  it("codeblock fences the selection", () => {
    const view = viewOf("const x = 1;", 0, 12);
    runMarkdownCommand(view, "codeblock");
    const doc = view.state.doc.toString();
    expect(doc).toContain("```\nconst x = 1;\n```");
    view.destroy();
  });

  it("codeblock inserts a placeholder when nothing is selected", () => {
    const view = viewOf("", 0);
    runMarkdownCommand(view, "codeblock");
    expect(view.state.doc.toString()).toBe("```\ncode\n```");
    view.destroy();
  });

  it("table inserts a header + separator + body", () => {
    const view = viewOf("", 0);
    runMarkdownCommand(view, "table");
    const doc = view.state.doc.toString();
    expect(doc).toContain("| Col 1 | Col 2 | Col 3 |");
    expect(doc).toContain("| --- | --- | --- |");
    view.destroy();
  });

  it("task toggles a list line to - [ ] ", () => {
    const view = viewOf("buy milk", 0);
    runMarkdownCommand(view, "task");
    expect(view.state.doc.toString()).toBe("- [ ] buy milk");
    view.destroy();
  });

  it("quote prefixes the line", () => {
    const view = viewOf("quoted text", 0);
    runMarkdownCommand(view, "quote");
    expect(view.state.doc.toString()).toBe("> quoted text");
    view.destroy();
  });

  it("link inserts a markdown link", () => {
    const view = viewOf("click", 0, 5);
    runMarkdownCommand(view, "link");
    expect(view.state.doc.toString()).toBe("[click](https://)");
    view.destroy();
  });

  it("image inserts an image markdown", () => {
    const view = viewOf("", 0);
    runMarkdownCommand(view, "image");
    expect(view.state.doc.toString()).toBe("![alt](path/to/image.png)");
    view.destroy();
  });
});
