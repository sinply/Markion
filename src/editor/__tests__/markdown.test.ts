import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../markdown";

describe("renderMarkdown", () => {
  it("renders GFM tables", () => {
    const html = renderMarkdown("| a | b |\n| - | - |\n| 1 | 2 |\n");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>1</td>");
  });

  it("renders strikethrough", () => {
    const html = renderMarkdown("~~deleted~~");
    expect(html).toContain("<s>deleted</s>");
  });

  it("renders fenced code blocks", () => {
    const html = renderMarkdown("```js\nconst x = 1;\n```\n");
    expect(html).toContain('<code class="language-js"');
    expect(html).toContain("hljs"); // syntax-highlighted
    expect(html).toContain("const");
  });

  it("renders headings", () => {
    const html = renderMarkdown("# Title\n\n## Subtitle\n");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<h2>Subtitle</h2>");
  });

  it("renders paragraphs", () => {
    const html = renderMarkdown("hello world\n");
    expect(html).toContain("<p>hello world</p>");
  });

  it("renders task lists with a disabled checkbox", () => {
    const html = renderMarkdown("- [ ] todo item\n- [x] done item\n");
    expect(html).toContain("task-list-item");
    expect(html).toContain('type="checkbox"');
    // Preview is read-only: the checkbox must be disabled (toggling lives in
    // the live-preview widget).
    expect(html).toContain("disabled");
    expect(html).toContain("todo item");
    expect(html).toContain("done item");
  });

  it("renders mermaid fences as a pending container for hydration", () => {
    const html = renderMarkdown("```mermaid\ngraph TD\n  A-->B\n```\n");
    expect(html).toContain("cm-mermaid-pending");
    expect(html).toContain("graph TD");
    // The code is kept as text content (escaped), not lost.
    expect(html).not.toContain("<pre>");
  });

  it("renders gantt / sequenceDiagram fences as mermaid too", () => {
    const gantt = renderMarkdown("```gantt\ntitle Plan\nsection S\nA: 1, 2\n```\n");
    expect(gantt).toContain("cm-mermaid-pending");
    expect(gantt).toContain("title Plan");
    const seq = renderMarkdown("```sequenceDiagram\nA->>B: hi\n```\n");
    expect(seq).toContain("cm-mermaid-pending");
  });

  it("keeps non-mermaid fences as code blocks", () => {
    const html = renderMarkdown("```ts\nlet x = 1;\n```\n");
    expect(html).toContain("<pre>");
    expect(html).toContain("hljs");
    expect(html).toContain("let");
  });

  it("renders ==highlight== as a <mark> element", () => {
    const html = renderMarkdown("Some ==highlighted text== here\n");
    expect(html).toContain("<mark>highlighted text</mark>");
  });

  it("renders footnote refs and definitions", () => {
    const html = renderMarkdown("Text with a footnote[^1].\n\n[^1]: The note body.\n");
    expect(html).toContain("footnote-ref");
    expect(html).toContain("The note body.");
  });

  it("renders ^sup^ and ~sub~", () => {
    const html = renderMarkdown("E=^mc2^, H~2~O\n");
    expect(html).toContain("<sup>mc2</sup>");
    expect(html).toContain("<sub>2</sub>");
  });

  it("highlights systemverilog fences via the verilog alias", () => {
    const html = renderMarkdown(
      "```systemverilog\nmodule m; endmodule\n```\n",
    );
    expect(html).toContain("hljs-");
  });
});
