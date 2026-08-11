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
    expect(html).toContain("<code");
    expect(html).toContain("const x = 1");
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
});
