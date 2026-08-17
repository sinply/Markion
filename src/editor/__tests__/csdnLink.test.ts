import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Table, TaskList, Strikethrough } from "@lezer/markdown";
import { buildDecorations } from "../livePreview";
import { highlightCode } from "../markdown";

const CSDN_LINK =
  "[SystemVerilog——fork...join并发结构_systemverilog fork join-CSDN博客]" +
  "(https://blog.csdn.net/qq_40893012/article/details/114763340" +
  "#:~:text=SystemVerilog%E2%80%94%E2%80%94fork...join%E5%B9%B6%E5%8F%91%E7%BB%93%E6%9E%84)";

function stateOf(doc: string, selectionHead?: number): EditorState {
  return EditorState.create({
    doc,
    selection: selectionHead === undefined ? undefined : { anchor: selectionHead },
    extensions: [
      markdown({ base: markdownLanguage, extensions: [Table, TaskList, Strikethrough] }),
    ],
  });
}

/** Collect (from, to, class) for every decoration in a set. */
function snapshot(state: EditorState) {
  const decos = buildDecorations(state);
  const out: { from: number; to: number; cls: string }[] = [];
  decos.between(0, state.doc.length, (from, to, deco) => {
    out.push({ from, to, cls: deco.spec.attributes?.class ?? "" });
  });
  return out;
}

const TITLE = "SystemVerilog——fork...join并发结构_systemverilog fork join-CSDN博客";

describe("long CSDN-style link in live preview", () => {
  it("shows only the title when the cursor is away from the link", () => {
    const state = stateOf("intro\n\n" + CSDN_LINK, 2); // cursor on "intro"
    const decos = snapshot(state);
    // Title span is exactly the visible text (no URL).
    const title = decos.find((d) => d.cls.includes("cm-link") && !d.cls.includes("cm-hidden"));
    expect(title).toBeTruthy();
    expect(state.doc.sliceString(title!.from, title!.to)).toBe(TITLE);

    // The URL itself must be hidden (cm-hidden), not shown as plain text.
    const doc = state.doc.toString();
    const urlStart = doc.indexOf("https://");
    const urlEnd = doc.indexOf(")");
    const urlCovered = decos.some(
      (d) =>
        d.cls.includes("cm-hidden") &&
        d.from <= urlStart &&
        d.to >= urlEnd,
    );
    expect(urlCovered).toBe(true);
  });

  it("reverts to visible source syntax when the cursor is on the link line", () => {
    const state = stateOf("intro\n\n" + CSDN_LINK, 70); // cursor inside the title
    const decos = snapshot(state);
    const doc = state.doc.toString();
    const urlStart = doc.indexOf("https://");
    const urlEnd = doc.indexOf(")");
    // URL is no longer fully hidden on the active line (semi-transparent mark).
    const urlVisible = decos.some(
      (d) => d.cls.includes("cm-active-line-mark") && d.from <= urlStart && d.to >= urlEnd,
    );
    expect(urlVisible).toBe(true);
  });
});

describe("code block syntax highlighting", () => {
  it("highlights verilog keywords with hljs spans", () => {
    const html = highlightCode("module m;\n  always @(posedge clk) begin\n    out <= in;\n  end\nendmodule", "verilog");
    expect(html).toContain("hljs-keyword");
    expect((html.match(/hljs-/g) ?? []).length).toBeGreaterThan(2);
  });

  it("highlights javascript keywords", () => {
    const html = highlightCode("const x = 1;", "javascript");
    expect(html).toContain("hljs-keyword");
    expect(html).toContain("hljs-number");
  });

  it("highlights scala (registered extra language)", () => {
    const html = highlightCode(
      "object Main extends App {\n  val x: Int = 42\n  println(x)\n}",
      "scala",
    );
    expect(html).toContain("hljs-keyword"); // object / val / extends
    expect(html).toContain("hljs-type");    // App / Int
  });

  it("escapes plain text for unknown languages", () => {
    const html = highlightCode("a < b && c > d", "notalang");
    expect(html).toBe("a &lt; b &amp;&amp; c &gt; d");
    expect(html).not.toContain("hljs-");
  });
});
