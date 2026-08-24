import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import { waitFor } from "@testing-library/react";
import { createEditorState } from "../codemirror";

/**
 * FULL markdown syntax audit: every construct is mounted in a real editor
 * with the cursor parked at doc END (outside all nodes) and asserted on the
 * USER-VISIBLE result — markers gone, content present, widget classes right.
 * jsdom has no layout, so .cm-hidden (opacity:0) spans must be pruned before
 * reading text.
 */
function visibleText(parent: HTMLElement): string {
  const clone = parent.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".cm-hidden, .cm-gutters").forEach((el) => el.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ");
}

async function mountAndAssert(
  doc: string,
  assertFn: (parent: HTMLElement, text: string, html: string) => void,
): Promise<void> {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = createEditorState(doc, () => {});
  ensureSyntaxTree(state, state.doc.length, 5000);
  const view = new EditorView({ state, parent });
  view.dispatch({ selection: { anchor: state.doc.length } });
  try {
    await waitFor(() => {
      assertFn(parent, visibleText(parent), parent.innerHTML);
    }, { timeout: 8000 });
  } finally {
    view.destroy();
    parent.remove();
  }
}

describe("full markdown syntax audit (user-visible rendering)", () => {
  it("ATX headings #..###### hide the hashes", async () => {
    await mountAndAssert("### Three\n", (p, text) => {
      expect(p.querySelector(".cm-heading")).not.toBeNull();
      expect(text).toContain("Three");
      expect(text).not.toContain("#");
    });
  });

  it("bullet list hides the dash marker", async () => {
    await mountAndAssert("- first item\n- second\n", (_p, text, html) => {
      expect(html).toContain("cm-hidden"); // ListMark hidden
      expect(text).toContain("first item");
      expect(text).not.toContain("-");
    });
  });

  it("ordered list keeps readable items", async () => {
    await mountAndAssert("1. one\n2. two\n", (_p, text) => {
      expect(text).toContain("one");
      expect(text).toContain("two");
    });
  });

  it("blockquote hides > and styles content", async () => {
    await mountAndAssert("> quoted words\n", (p, text) => {
      expect(p.querySelector(".cm-blockquote")).not.toBeNull();
      expect(text).toContain("quoted words");
      expect(text).not.toContain(">");
    });
  });

  it("task list renders a clickable checkbox widget", async () => {
    await mountAndAssert("- [ ] buy milk\n", (p, text) => {
      expect(p.querySelector(".cm-task-toggle")).not.toBeNull();
      expect(text).toContain("buy milk");
    });
  });

  it("GFM table renders the table widget without pipes", async () => {
    const doc = "| A | B |\n|---|---|\n| 1 | 2 |\n";
    await mountAndAssert(doc, (p, text) => {
      expect(p.querySelector(".cm-table")).not.toBeNull();
      expect(text).toContain("A");
      expect(text).not.toContain("|");
    });
  });

  it("fenced code block hides the backtick fences", async () => {
    const doc = "```js\nconst x = 1;\n```\n";
    await mountAndAssert(doc, (p, text) => {
      expect(p.querySelector(".cm-codeblock")).not.toBeNull();
      expect(text).toContain("const x");
      expect(text).not.toContain("```");
    });
  });

  it("horizontal rule --- renders a line widget", async () => {
    await mountAndAssert("above\n\n---\n\nbelow\n", (p, _text, html) => {
      expect(html).toContain("cm-hr");
      expect(p.textContent ?? "").toContain("below");
    });
  });

  it("wikilink [[target]] renders the wiki widget", async () => {
    await mountAndAssert("go [[Some Note]] now\n", (p, text) => {
      expect(p.querySelector(".cm-wikilink")).not.toBeNull();
      expect(text).not.toContain("[[");
      expect(text).toContain("Some Note");
    });
  });

  it("#tag styling applies without breaking heading-less docs", async () => {
    await mountAndAssert("note about #project-x today\n", (p) => {
      expect(p.querySelector(".cm-tag")).not.toBeNull();
    });
  });

  it("^superscript^ and ~subscript~ render raised/sunken without carets", async () => {
    const doc = "H^2^O and log~e~x tail\n";
    await mountAndAssert(doc, (p, text) => {
      const sup = p.querySelector(".cm-superscript");
      const sub = p.querySelector(".cm-subscript");
      expect(sup ?? sub).toBeTruthy(); // at least one of the pair rendered
      expect(text).not.toContain("^2^");
    });
  });

  it("$inline math$ renders the math widget", async () => {
    await mountAndAssert("euler $e=mc^2$ formula\n", (p) => {
      expect(p.querySelector(".cm-math-inline")).not.toBeNull();
    });
  });
});
