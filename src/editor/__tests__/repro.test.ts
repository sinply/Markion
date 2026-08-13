import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { createEditorState } from "../codemirror";
import { buildDecorations } from "../livePreview";

// Smoke test on a large, mixed-feature document (replaces an earlier version
// that read a file from an absolute path on the author's machine, which broke
// on every other machine).
const realContent = [
  "# CATALOG",
  "",
  "Intro paragraph with **bold**, *italic*, `code`, and a [link](https://example.com).",
  "",
  "## Section 1",
  "",
  "- [x] done task",
  "- [ ] open task",
  "1. numbered item",
  "",
  "> A quote with **bold** inside.",
  "",
  "```ts",
  "function hello(): string {",
  '  return "world";',
  "}",
  "```",
  "",
  "```mermaid",
  "graph TD;",
  "  A-->B;",
  "```",
  "",
  "| col A | col B |",
  "| ----- | ----- |",
  "| 1     | 2     |",
  "",
  "Inline math $x^2$ and block math:",
  "",
  "$$",
  "\\int_0^1 x^2 dx",
  "$$",
  "",
  "A wikilink [[notes/design]] and an alias [[notes/design|design doc]].",
  "",
  "![alt text](img/example.png)",
  "",
  "---",
  "",
  "```python",
  "print('trailing fenced block with no newline')",
  "```",
].join("\n");

describe("repro: real CATALOG.md in a mounted EditorView", () => {
  it("builds decorations on real content without throwing", () => {
    const state = createEditorState(realContent, () => {});
    let threw: Error | null = null;
    try {
      buildDecorations(state);
    } catch (e: any) {
      threw = e;
    }
    expect(threw).toBeNull();
  });

  it("mounts an EditorView with live preview without throwing", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const state = createEditorState(realContent, () => {});
    let threw: Error | null = null;
    try {
      const view = new EditorView({ state, parent });
      view.destroy();
    } catch (e: any) {
      threw = e;
    }
    expect(threw).toBeNull();
  });
});
