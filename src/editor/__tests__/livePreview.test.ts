import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Table, TaskList, Strikethrough } from "@lezer/markdown";
import { buildDecorations, resolveLinkUrl, isExternalUrl } from "../livePreview";
import { ImageWidget } from "../widgets";

function stateOf(doc: string, cursorPos?: number): EditorState {
  return EditorState.create({
    doc,
    selection: cursorPos !== undefined ? { anchor: cursorPos } : undefined,
    extensions: [markdown({ base: markdownLanguage, extensions: [Table, TaskList, Strikethrough] })],
  });
}

/** Put the cursor at the very end so no marker is on the active line (markers all hide). */
function stateOfEnd(doc: string): EditorState {
  return stateOf(doc, doc.length);
}

function countByClass(decos: ReturnType<typeof buildDecorations>, className: string): number {
  const iter = decos.iter();
  let count = 0;
  while (iter.value) {
    const cls = iter.value.spec?.attributes?.class || "";
    if (cls.includes(className)) count++;
    iter.next();
  }
  return count;
}

function hasWidget(decos: ReturnType<typeof buildDecorations>): boolean {
  const iter = decos.iter();
  while (iter.value) {
    if (iter.value.spec?.widget) return true;
    iter.next();
  }
  return false;
}

function findImageWidget(decos: ReturnType<typeof buildDecorations>): ImageWidget | null {
  const iter = decos.iter();
  while (iter.value) {
    const w = iter.value.spec?.widget;
    if (w instanceof ImageWidget) return w;
    iter.next();
  }
  return null;
}

describe("buildDecorations", () => {
  it("hides bold emphasis markers (**)", () => {
    // On a single-line doc the cursor is on the active line, so markers are
    // either fully hidden (cm-mark) or faint (cm-active-line-mark). Either way
    // the two ** markers are decorated.
    const decos = buildDecorations(stateOf("**bold** text"));
    expect(countByClass(decos, "cm-mark") + countByClass(decos, "cm-active-line-mark")).toBe(2);
  });

  it("hides inline code backticks", () => {
    const decos = buildDecorations(stateOf("`code` text"));
    expect(countByClass(decos, "cm-mark") + countByClass(decos, "cm-active-line-mark")).toBe(2); // opening + closing `
    expect(countByClass(decos, "cm-inline-code")).toBe(1); // whole inline code styled
  });

  it("does NOT hide markers inside code blocks", () => {
    const decos = buildDecorations(stateOf("```\n**not bold**\n```\n"));
    // The fenced code block gets a widget replacement; no inline decorations
    expect(countByClass(decos, "cm-mark")).toBe(0);
  });

  it("replaces a fenced code block with a widget", () => {
    const decos = buildDecorations(stateOf("```js\nlet x = 1;\n```\n"));
    expect(hasWidget(decos)).toBe(true);
  });

  it("hides link brackets and styles link text", () => {
    const decos = buildDecorations(stateOf("[link](https://a.com)"));
    expect(countByClass(decos, "cm-link-marker")).toBeGreaterThanOrEqual(2);
    expect(countByClass(decos, "cm-link")).toBeGreaterThan(0);
  });

  it("replaces a GFM table with a widget", () => {
    const decos = buildDecorations(stateOf("| a | b |\n| - | - |\n| 1 | 2 |\n"));
    expect(hasWidget(decos)).toBe(true);
  });

  it("replaces a task marker with a checkbox widget", () => {
    const decos = buildDecorations(stateOf("- [ ] buy milk\n"));
    expect(hasWidget(decos)).toBe(true);
  });

  it("styles headings and hides the # mark", () => {
    const decos = buildDecorations(stateOfEnd("# Title\n"));
    expect(countByClass(decos, "cm-heading")).toBeGreaterThan(0);
    expect(countByClass(decos, "cm-mark")).toBeGreaterThan(0); // # hidden
  });

  it("replaces an image with an ImageWidget", () => {
    const decos = buildDecorations(stateOf("![alt](img.png)"));
    const widget = findImageWidget(decos);
    expect(widget).not.toBeNull();
    expect(widget!.src).toBe("img.png");
    expect(widget!.alt).toBe("alt");
  });

  it("does not leak hidden marks for a bare image", () => {
    const decos = buildDecorations(stateOf("![alt](img.png)"));
    expect(countByClass(decos, "cm-mark")).toBe(0);
    expect(countByClass(decos, "cm-link")).toBe(0);
  });

  it("renders an image nested inside a link and hides outer brackets", () => {
    const decos = buildDecorations(stateOf("[![a](img.png)](https://link)"));
    const widget = findImageWidget(decos);
    expect(widget).not.toBeNull();
    expect(widget!.src).toBe("img.png");
    // No text-level .cm-link mark should leak from the outer link
    expect(countByClass(decos, "cm-link")).toBe(0);
  });
});

describe("resolveLinkUrl", () => {
  it("extracts the URL from a plain link", () => {
    const state = stateOf("[text](https://a.com)");
    expect(resolveLinkUrl(state, 2)).toBe("https://a.com");
  });

  it("extracts the parent link URL when clicking inside an image", () => {
    const state = stateOf("[![a](img.png)](https://link)");
    const pos = state.doc.toString().indexOf("img.png");
    expect(resolveLinkUrl(state, pos + 1)).toBe("https://link");
  });

  it("returns null for plain text", () => {
    const state = stateOf("just some text");
    expect(resolveLinkUrl(state, 2)).toBeNull();
  });
});

describe("isExternalUrl", () => {
  it("accepts http(s) and rejects relative paths", () => {
    expect(isExternalUrl("https://a.com")).toBe(true);
    expect(isExternalUrl("http://a.com")).toBe(true);
    expect(isExternalUrl("../other.md")).toBe(false);
    expect(isExternalUrl("other.md")).toBe(false);
  });
});

describe("frontmatter", () => {
  it("keeps a leading YAML frontmatter block as editable source in edit mode", () => {
    const state = stateOf("---\nauthor: sinply\ncreated: 2022-03-12\n---\n\n# Title\n");
    const decos = buildDecorations(state);
    const iter = decos.iter();
    let foundFrontmatter = false;
    while (iter.value) {
      const spec = iter.value.spec;
      if (spec?.widget && spec.widget.constructor.name === "FrontmatterWidget") {
        foundFrontmatter = true;
      }
      iter.next();
    }
    // Edit mode must NOT replace frontmatter with a read-only widget — the
    // user needs to edit the YAML source directly.
    expect(foundFrontmatter).toBe(false);
    // The frontmatter text is still in the doc (source preserved).
    expect(state.doc.toString()).toContain("author: sinply");
  });

  it("does NOT replace a horizontal rule mid-document", () => {
    const state = stateOf("Text before\n\n---\n\nafter\n");
    const decos = buildDecorations(state);
    const iter = decos.iter();
    let foundFrontmatter = false;
    while (iter.value) {
      const spec = iter.value.spec;
      if (spec?.widget && spec.widget.constructor.name === "FrontmatterWidget") {
        foundFrontmatter = true;
      }
      iter.next();
    }
    expect(foundFrontmatter).toBe(false);
  });
});

describe("inline math", () => {
  it("replaces $...$ with an inline math widget", () => {
    const decos = buildDecorations(stateOf("Euler: $e^{i\pi} = -1$ is neat."));
    const iter = decos.iter();
    let found = false;
    while (iter.value) {
      const w = iter.value.spec?.widget;
      if (w && w.constructor.name === "MathInlineWidget") {
        found = true;
        expect(w.tex).toContain("e^{i");
      }
      iter.next();
    }
    expect(found).toBe(true);
  });

  it("does NOT treat $$...$$ as inline math", () => {
    const decos = buildDecorations(stateOf("$$\nE = mc^2\n$$"));
    const iter = decos.iter();
    let inline = false;
    while (iter.value) {
      const w = iter.value.spec?.widget;
      if (w && w.constructor.name === "MathInlineWidget") inline = true;
      iter.next();
    }
    expect(inline).toBe(false);
  });
});
