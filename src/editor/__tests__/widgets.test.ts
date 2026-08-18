import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { TaskCheckboxWidget, CodeBlockWidget, TableWidget, ImageWidget, MathBlockWidget, CalloutWidget, EmbedWidget, PreviewWidget, transformTable, extractSection } from "../widgets";
import type { EditorView } from "@codemirror/view";
import { markdownContextFacet, type MarkdownContext } from "../media";

function mockView(): EditorView {
  return { state: EditorState.create({}), dispatch: () => {} } as unknown as EditorView;
}

function viewWithContext(ctx?: MarkdownContext): EditorView {
  const state = EditorState.create({
    extensions: ctx ? markdownContextFacet.of(ctx) : [],
  });
  return { state } as unknown as EditorView;
}

describe("TaskCheckboxWidget", () => {
  it("renders unchecked input for false", () => {
    const w = new TaskCheckboxWidget(false);
    const dom = w.toDOM(mockView());
    const input = dom.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.checked).toBe(false);
    expect(input.disabled).toBe(true);
  });

  it("renders checked input for true", () => {
    const w = new TaskCheckboxWidget(true);
    const dom = w.toDOM(mockView());
    const input = dom.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(input.checked).toBe(true);
  });

  it("eq returns true for same checked state", () => {
    expect(new TaskCheckboxWidget(true).eq(new TaskCheckboxWidget(true))).toBe(true);
    expect(new TaskCheckboxWidget(false).eq(new TaskCheckboxWidget(false))).toBe(true);
  });

  it("eq returns false for different checked state", () => {
    expect(new TaskCheckboxWidget(true).eq(new TaskCheckboxWidget(false))).toBe(false);
  });
});

describe("CodeBlockWidget", () => {
  it("renders highlighted code in a contenteditable that commits plain text", () => {
    const w = new CodeBlockWidget("let x = 1;", "ts");
    const dom = w.toDOM(mockView());
    const code = dom.querySelector("code")!;
    expect(code).toBeTruthy();
    // Syntax highlighting by fence language (hljs spans).
    expect(code.innerHTML).toContain("hljs-keyword");
    // textContent stays the verbatim source — edits commit via textContent,
    // so highlighting is purely presentational and never corrupts the doc.
    expect(code.textContent).toBe("let x = 1;");
    expect(code.getAttribute("contenteditable")).toBe("true");
  });

  it("shows language badge", () => {
    const w = new CodeBlockWidget("code", "rust");
    const dom = w.toDOM(mockView());
    expect(dom.textContent).toContain("rust");
  });
});

describe("TableWidget", () => {
  it("renders markdown table to HTML with a toolbar", () => {
    const w = new TableWidget("| a | b |\n| - | - |\n| 1 | 2 |\n");
    const dom = w.toDOM(mockView());
    expect(dom.innerHTML).toContain("<table>");
    expect(dom.querySelector(".cm-table-toolbar")).toBeTruthy();
    const buttons = dom.querySelectorAll(".cm-table-btn");
    expect(buttons.length).toBe(4);
  });
});

describe("transformTable (row/column operations)", () => {
  const raw = "| a | b |\n| - | - |\n| 1 | 2 |\n";

  it("addRow appends an empty row", () => {
    const next = transformTable(raw, "addRow")!;
    expect(next).toBe("| a | b |\n| - | - |\n| 1 | 2 |\n|  |  |");
  });

  it("removeRow drops the last body row", () => {
    const next = transformTable(raw, "removeRow")!;
    expect(next).toBe("| a | b |\n| - | - |");
  });

  it("removeRow is a no-op when there are no body rows", () => {
    expect(transformTable("| a | b |\n| - | - |", "removeRow")).toBeNull();
  });

  it("addCol appends a column to header, align, and every row", () => {
    const next = transformTable(raw, "addCol")!;
    expect(next).toBe("| a | b |  |\n| - | - | --- |\n| 1 | 2 |  |");
  });

  it("removeCol drops the last column", () => {
    const next = transformTable(raw, "removeCol")!;
    expect(next).toBe("| a |\n| - |\n| 1 |");
  });

  it("removeCol is a no-op for a single-column table", () => {
    expect(transformTable("| a |\n| - |\n| 1 |", "removeCol")).toBeNull();
  });

  it("preserves escaped pipes in cells", () => {
    const tricky = "| a | b\\|c |\n| - | - |\n| 1 | 2 |";
    const next = transformTable(tricky, "addRow")!;
    expect(next).toContain("| b\\|c |");
  });
});

describe("CalloutWidget", () => {
  it("renders a card with type title and rendered body", () => {
    const w = new CalloutWidget("note", "**bold** text");
    const dom = w.toDOM();
    expect(dom.className).toContain("cm-callout");
    expect(dom.className).toContain("cm-callout-note");
    expect(dom.querySelector(".cm-callout-title")?.textContent).toBe("note");
    expect(dom.querySelector(".cm-callout-body")?.innerHTML).toContain("<strong>bold</strong>");
  });

  it("eq compares type and body", () => {
    expect(new CalloutWidget("note", "x").eq(new CalloutWidget("note", "x"))).toBe(true);
    expect(new CalloutWidget("note", "x").eq(new CalloutWidget("tip", "x"))).toBe(false);
  });
});

describe("extractSection (embed headings)", () => {
  it("returns the section under a heading up to the next same-level heading", () => {
    const content = "# Top\nintro\n## Sub\nbody text\n## Next\nafter";
    expect(extractSection(content, "Sub")).toBe("body text\n");
  });

  it("returns the whole remainder for the last heading", () => {
    const content = "# A\none\n# B\ntwo\nthree";
    expect(extractSection(content, "B")).toBe("two\nthree");
  });

  it("returns empty for a missing heading", () => {
    expect(extractSection("# A\nx", "Nope")).toBe("");
  });

  it("stops at a higher-level heading too", () => {
    const content = "## A\nx\n# Top\ny";
    expect(extractSection(content, "A")).toBe("x\n");
  });
});

describe("EmbedWidget", () => {
  it("starts in a loading state", () => {
    const w = new EmbedWidget("note", null);
    const dom = w.toDOM(mockView());
    expect(dom.className).toContain("cm-embed-loading");
    expect(dom.textContent).toContain("Loading");
  });

  it("eq compares target and heading", () => {
    expect(new EmbedWidget("a", null).eq(new EmbedWidget("a", null))).toBe(true);
    expect(new EmbedWidget("a", "h").eq(new EmbedWidget("a", "h"))).toBe(true);
    expect(new EmbedWidget("a", null).eq(new EmbedWidget("b", null))).toBe(false);
    expect(new EmbedWidget("a", "h").eq(new EmbedWidget("a", null))).toBe(false);
  });
});

describe("PreviewWidget (full-document preview mode)", () => {
  it("renders task lists as checkboxes like the live editor", () => {
    const w = new PreviewWidget("- [ ] pending\n- [x] done\n");
    const dom = w.toDOM(mockView());
    const boxes = dom.querySelectorAll<HTMLInputElement>(".cm-preview-body input[type=checkbox]");
    expect(boxes.length).toBe(2);
    expect(boxes[0].checked).toBe(false);
    expect(boxes[1].checked).toBe(true);
    expect(boxes[0].disabled).toBe(true);
  });

  it("hydrates mermaid fences into diagram containers", () => {
    const w = new PreviewWidget("```mermaid\ngraph TD\n  A-->B\n```\n");
    const dom = w.toDOM(mockView());
    const mermaid = dom.querySelector<HTMLElement>(".cm-mermaid");
    expect(mermaid).toBeTruthy();
    // Fallback shows the source until mermaid (lazy import) renders.
    expect(mermaid?.textContent).toContain("graph TD");
  });
});

describe("ImageWidget", () => {
  function imgOf(w: ImageWidget, view: EditorView): HTMLImageElement {
    return w.toDOM(view).querySelector("img") as HTMLImageElement;
  }

  it("renders an img with cm-image class and alt inside a wrap", () => {
    const w = new ImageWidget("img.png", "my alt");
    const wrap = w.toDOM(mockView());
    expect(wrap.className).toBe("cm-image-wrap");
    const img = wrap.querySelector("img") as HTMLImageElement;
    expect(img.className).toBe("cm-image");
    expect(img.alt).toBe("my alt");
    // No context: raw src used, no crash (convertFileSrc throws without Tauri)
    expect(img.getAttribute("src")).toBe("img.png");
  });

  it("resolves a relative src to an absolute path via the context facet", () => {
    const w = new ImageWidget("../assets/x.png", "");
    const img = imgOf(w, viewWithContext({ vaultRoot: "C:/vault", docRel: "notes/a.md" }));
    // convertFileSrc throws in jsdom -> imageToSrc falls back to the absolute path
    expect(img.getAttribute("src")).toBe("C:/vault/assets/x.png");
  });

  it("keeps remote src unchanged even with context", () => {
    const w = new ImageWidget("https://example.com/x.png", "");
    const img = imgOf(w, viewWithContext({ vaultRoot: "C:/vault", docRel: "a.md" }));
    expect(img.getAttribute("src")).toBe("https://example.com/x.png");
  });

  it("strips the Referer header so hotlink-protected CDNs allow the image", () => {
    const w = new ImageWidget("https://example.com/x.png", "");
    const img = imgOf(w, mockView());
    expect(img.referrerPolicy).toBe("no-referrer");
  });

  it("shows a placeholder with the filename when the image fails to load", () => {
    const w = new ImageWidget("image-11.png", "");
    const wrap = w.toDOM(mockView());
    const img = wrap.querySelector("img")!;
    img.dispatchEvent(new Event("error"));
    const placeholder = wrap.querySelector(".cm-image-placeholder") as HTMLSpanElement;
    expect(placeholder).toBeTruthy();
    expect(placeholder.textContent).toContain("image-11.png");
    expect(wrap.querySelector("img")).toBeNull();
  });

  it("eq compares src and alt", () => {
    expect(new ImageWidget("a.png", "x").eq(new ImageWidget("a.png", "x"))).toBe(true);
    expect(new ImageWidget("a.png", "x").eq(new ImageWidget("b.png", "x"))).toBe(false);
    expect(new ImageWidget("a.png", "x").eq(new ImageWidget("a.png", "y"))).toBe(false);
  });
});

describe("CodeBlockWidget mermaid", () => {
  it("renders a mermaid container for mermaid blocks", () => {
    const w = new CodeBlockWidget("graph TD\n  A-->B", "mermaid");
    const dom = w.toDOM(mockView());
    expect(dom.className).toBe("cm-mermaid");
  });
});

describe("MathBlockWidget", () => {
  it("renders a math-block container with tex fallback", () => {
    const w = new MathBlockWidget("E = mc^2");
    const dom = w.toDOM(mockView());
    expect(dom.className).toBe("cm-math-block");
    // katex loads async; fallback text present immediately
    expect(dom.textContent).toContain("E = mc^2");
  });

  it("eq compares tex", () => {
    expect(new MathBlockWidget("a").eq(new MathBlockWidget("a"))).toBe(true);
    expect(new MathBlockWidget("a").eq(new MathBlockWidget("b"))).toBe(false);
  });
});
