import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { createEditorState } from "../codemirror";
import { renderMarkdownWithTableSource } from "../markdown";
import { serializeTableCells } from "../widgets";

const DOC = "| A | B |\n| --- | --- |\n| *em* | `code` |\n\nx\n";

function mount() {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = createEditorState(DOC, () => {}, { onStateChange: () => {} });
  const view = new EditorView({ state, parent });
  void view.contentDOM.offsetWidth;
  return { view, parent };
}

describe("table data-source injection", () => {
  it("renders each cell with a data-source attribute carrying the inline source", () => {
    const html = renderMarkdownWithTableSource("| A | B |\n| --- | --- |\n| *em* | `code` |");
    expect(html).toContain('data-source="*em*"');
    expect(html).toContain("<em>em</em></td>"); // rendered text still em
  });

  it("preserves alignment markers", () => {
    const html = renderMarkdownWithTableSource("| A | B |\n| :--- | ---: |\n| x | y |");
    expect(html).toContain('style="text-align:left"');
    expect(html).toContain('style="text-align:right"');
  });
});

describe("TableWidget serialize", () => {
  it("renders editable cells", () => {
    const { view, parent } = mount();
    // Move the cursor off the table so it renders as a widget (not source).
    view.dispatch({ selection: { anchor: DOC.length } });
    const cells = parent.querySelectorAll(".cm-table [contenteditable='true']");
    expect(cells.length).toBe(4);
    view.destroy();
    document.body.removeChild(parent);
  });

  it("preserves a format wrap when a cell's inner text is edited", () => {
    const div = document.createElement("div");
    div.innerHTML = renderMarkdownWithTableSource("| A | B |\n| --- | --- |\n| *em* | `code` |");
    // change the first body cell text from 'em' to 'em!'
    const firstBodyCell = div.querySelector("tbody td") as HTMLElement;
    firstBodyCell.textContent = "em!";
    const out = serializeTableCells(div);
    expect(out).toContain("*em!*");
    expect(out).toContain("`code`");
  });

  it("preserves escaped pipes and unchanged source cells verbatim", () => {
    const div = document.createElement("div");
    div.innerHTML = renderMarkdownWithTableSource("| A | B |\n| --- | --- |\n| a\\|b | c |");
    const out = serializeTableCells(div);
    // The parser unescaped the pipe in data-source (`a|b`), so the serializer
    // re-escapes the literal delimiter pipe on write-back to keep the row valid.
    expect(out).toContain("a\\|b");
  });

  it("re-escapes a literal pipe inside a format wrap so it round-trips as one cell", () => {
    const div = document.createElement("div");
    div.innerHTML = renderMarkdownWithTableSource("| A | B |\n| --- | --- |\n| *a\\|b* | c |");
    const out = serializeTableCells(div);
    // The parser unescaped the pipe inside the wrap (data-source is `*a|b*`), so
    // the serializer must re-escape it on write-back, or the pipe re-splits the
    // row into extra columns (and the emphasis wrap is destroyed).
    expect(out).toContain("*a\\|b*");
    // Re-parsing the serialized output must keep 2 columns, not 3.
    const re = document.createElement("div");
    re.innerHTML = renderMarkdownWithTableSource(out);
    const bodyCells = Array.from(re.querySelectorAll("tbody tr")).map((tr) =>
      Array.from(tr.querySelectorAll("th, td")).length,
    );
    expect(bodyCells[0]).toBe(2);
  });

  it("does not rewrite the source on a no-op blur (unchanged escaped pipe)", () => {
    const div = document.createElement("div");
    div.innerHTML = renderMarkdownWithTableSource("| A | B |\n| --- | --- |\n| *a\\|b* | c |");
    const out = serializeTableCells(div);
    // An unchanged table must serialize back to the exact original source —
    // the wrapped escaped pipe is not a formatting/emphasis edit.
    expect(out).toBe("| A | B |\n| --- | --- |\n| *a\\|b* | c |");
  });
});
