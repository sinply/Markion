import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Table, TaskList, Strikethrough } from "@lezer/markdown";
import { buildDecorations, resolveLinkUrl, isExternalUrl, parseCallout } from "../livePreview";
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
    // cursor at end (non-active line) → block gets replaced
    const decos = buildDecorations(stateOfEnd("```js\nlet x = 1;\n```\n"));
    expect(hasWidget(decos)).toBe(true);
  });

  it("hides link brackets and URL, styles link text", () => {
    // Cursor on the first line, away from the link line: brackets + URL are
    // hidden, only the title text carries the link style.
    const decos = buildDecorations(stateOf("intro\n[link](https://a.com)", 2));
    expect(countByClass(decos, "cm-hidden")).toBeGreaterThanOrEqual(4); // [ ] ( + URL
    expect(countByClass(decos, "cm-link")).toBeGreaterThan(0);
  });

  it("replaces a GFM table with a widget", () => {
    const decos = buildDecorations(stateOfEnd("| a | b |\n| - | - |\n| 1 | 2 |\n"));
    expect(hasWidget(decos)).toBe(true);
  });

  it("replaces a task marker with a checkbox widget", () => {
    const decos = buildDecorations(stateOfEnd("- [ ] buy milk\n"));
    expect(hasWidget(decos)).toBe(true);
  });

  it("styles headings and hides the # mark", () => {
    const decos = buildDecorations(stateOfEnd("# Title\n"));
    expect(countByClass(decos, "cm-heading")).toBeGreaterThan(0);
    expect(countByClass(decos, "cm-mark")).toBeGreaterThan(0); // # hidden
  });

  it("replaces an image with an ImageWidget", () => {
    // image on line 1, cursor on line 2 (non-active) → replaced
    const decos = buildDecorations(stateOfEnd("![alt](img.png)\n\nsecond line\n"));
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
    const decos = buildDecorations(stateOfEnd("[![a](img.png)](https://link)\n\nline two\n"));
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

  it("renders headings AFTER the frontmatter when the cursor is past the block", () => {
    // Regression: the frontmatter guard pruned the Document root, so every
    // decoration after the block (headings, code blocks, tables) vanished.
    const doc = "---\nauthor: x\n---\n\n## Heading\n\n### Sub\n";
    const state = stateOf(doc);
    // Cursor past the closing --- (headings visible, frontmatter shows card).
    const moved = state.update({ selection: { anchor: doc.length } }).state;
    const decos = buildDecorations(moved);
    let headingCount = 0;
    let frontmatterCard = false;
    const iter = decos.iter();
    while (iter.value) {
      const spec = iter.value.spec;
      if (spec?.attributes?.class === "cm-heading") headingCount++;
      if (spec?.widget && spec.widget.constructor.name === "FrontmatterWidget") frontmatterCard = true;
      iter.next();
    }
    expect(headingCount).toBeGreaterThanOrEqual(2);
    expect(frontmatterCard).toBe(true);
  });
});

describe("inline syntax inside headings", () => {
  it("styles **bold** inside a heading instead of showing literal markers", () => {
    // Regression: the heading branch used to `return false`, which skipped
    // its child inline nodes — `## **加粗**` rendered the literal `**`.
    const doc = "## **加粗** 标题\n";
    const state = stateOf(doc);
    const moved = state.update({ selection: { anchor: doc.length } }).state;
    const decos = buildDecorations(moved);
    let heading = 0;
    let emphasis = 0;
    let hiddenMarks = 0;
    const iter = decos.iter();
    while (iter.value) {
      const spec = iter.value.spec;
      const cls = spec?.attributes?.class ?? "";
      if (cls.includes("cm-heading")) heading++;
      if (cls.includes("cm-emphasis")) emphasis++;
      if (cls.includes("cm-hidden")) hiddenMarks++;
      iter.next();
    }
    expect(heading).toBeGreaterThanOrEqual(1);
    expect(emphasis).toBeGreaterThanOrEqual(1);
    expect(hiddenMarks).toBeGreaterThanOrEqual(2); // the two ** markers
  });
});

describe("inline math", () => {
  it("replaces $...$ with an inline math widget", () => {
    const decos = buildDecorations(stateOfEnd("Euler: $e^{i\pi} = -1$ is neat.\n\nsecond line\n"));
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

describe("parseCallout", () => {
  it("detects a callout with its type and body (incl. title-line remainder)", () => {
    const c = parseCallout("> [!note] Title\n> body line\n> second");
    expect(c).toEqual({ type: "note", body: "Title\nbody line\nsecond" });
  });

  it("returns null for a plain blockquote", () => {
    expect(parseCallout("> just a quote")).toBeNull();
  });

  it("returns null for an unknown callout type", () => {
    expect(parseCallout("> [!custom-thing] x")).toBeNull();
  });

  it("matches case-insensitively", () => {
    const c = parseCallout("> [!WARNING] careful");
    expect(c?.type).toBe("warning");
    expect(c?.body).toBe("careful");
  });
});

describe("#tag highlight", () => {
  it("marks #tags with the cm-tag class", () => {
    const decos = buildDecorations(stateOfEnd("see #todo and #设计 here\n\nmore\n"));
    expect(countByClass(decos, "cm-tag")).toBeGreaterThanOrEqual(2);
  });

  it("does not mark headings (# Title) as tags", () => {
    const decos = buildDecorations(stateOfEnd("# Title\n\nbody\n"));
    expect(countByClass(decos, "cm-tag")).toBe(0);
  });

  it("does not mark tags inside fenced code blocks", () => {
    const decos = buildDecorations(stateOfEnd("```\n#notatag\n```\n\nok\n"));
    expect(countByClass(decos, "cm-tag")).toBe(0);
  });
});

describe("==highlight== decoration", () => {
  it("marks ==text== ranges with the cm-mark class", () => {
    const decos = buildDecorations(stateOfEnd("some ==important== words\n\nmore\n"));
    // 1 content style + the now-hidden == markers (2) share the cm-mark class.
    expect(countByClass(decos, "cm-mark")).toBe(3);
    expect(countByClass(decos, "cm-hidden")).toBeGreaterThanOrEqual(2);
  });

  it("does not mark == inside fenced code blocks", () => {
    const decos = buildDecorations(stateOfEnd("```\n==not mark==\n```\n\nok\n"));
    expect(countByClass(decos, "cm-mark")).toBe(0);
  });
});

describe("callout decoration", () => {
  it("replaces a > [!note] blockquote with a CalloutWidget", () => {
    const decos = buildDecorations(stateOfEnd("> [!tip] Try this\n> details\n\nbody\n"));
    const iter = decos.iter();
    let found = false;
    while (iter.value) {
      const w = iter.value.spec?.widget;
      if (w && w.constructor.name === "CalloutWidget") {
        found = true;
        expect(w.type).toBe("tip");
        expect(w.body).toContain("details");
      }
      iter.next();
    }
    expect(found).toBe(true);
  });
});

describe("embed decoration", () => {
  it("replaces ![[note]] with an EmbedWidget carrying target + heading", () => {
    const decos = buildDecorations(stateOfEnd("see ![[other#Section]] below\n\nbody\n"));
    const iter = decos.iter();
    let found = false;
    while (iter.value) {
      const w = iter.value.spec?.widget;
      if (w && w.constructor.name === "EmbedWidget") {
        found = true;
        expect(w.target).toBe("other");
        expect(w.heading).toBe("Section");
      }
      iter.next();
    }
    expect(found).toBe(true);
  });

  it("keeps plain wikilinks as WikiLinkWidget (not embeds)", () => {
    const decos = buildDecorations(stateOfEnd("link [[other]] here\n\nbody\n"));
    const iter = decos.iter();
    let embed = false;
    let wiki = false;
    while (iter.value) {
      const w = iter.value.spec?.widget;
      if (w?.constructor.name === "EmbedWidget") embed = true;
      if (w?.constructor.name === "WikiLinkWidget") wiki = true;
      iter.next();
    }
    expect(embed).toBe(false);
    expect(wiki).toBe(true);
  });
});
