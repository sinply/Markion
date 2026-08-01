import { describe, it, expect } from "vitest";
import { renderMarkdown, highlightCode } from "../markdown";

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

  it("syntax-highlights Verilog via highlightCode (used by the code-block widget)", () => {
    const html = highlightCode(
      "always @ (posedge clk) begin\n    if (rst == 1'b1)\n        Rnew <= 'd0;\nend\n",
      "verilog",
    );
    // highlight.js verilog produces hljs-* spans (keyword/type/etc.)
    expect(html).toContain("hljs-");
    expect(html).toContain("posedge");
  });

  it("syntax-highlights MATLAB via highlightCode", () => {
    const html = highlightCode(
      "for i = 1:14\n    if i <= 8\n        conf_list(i) = 85;\n    end\nend\n",
      "matlab",
    );
    expect(html).toContain("hljs-");
    expect(html).toContain("conf_list");
  });

  it("syntax-highlights VHDL via highlightCode", () => {
    const html = highlightCode(
      "process(clk) begin\n    if rising_edge(clk) then\n        q <= d;\n    end if;\nend process;\n",
      "vhdl",
    );
    expect(html).toContain("hljs-");
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
