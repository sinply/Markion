import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import { waitFor } from "@testing-library/react";
import { createEditorState } from "../codemirror";

/**
 * Regression tests for nested-inline rendering: the live-preview scanner used
 * to `return false` (prune the subtree) for Emphasis/StrongEmphasis/Link and
 * Blockquote, so any inline markup nested inside them kept its raw markers —
 * `**bold _italic_**` showed the underscores, `*a `code` b*` showed backticks,
 * `**see [x](url)**` showed the brackets and URL, and `> - item` showed the
 * list dash plus the second line's `>`.
 *
 * Assertions read the USER-VISIBLE result (jsdom has no layout, so the
 * opacity:0 .cm-hidden markers are pruned before reading text).
 */
function visibleText(parent: HTMLElement): string {
  const clone = parent.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".cm-hidden, .cm-gutters").forEach((el) => el.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

async function mount(
  doc: string,
  assertFn: (parent: HTMLElement, text: string, html: string) => void,
): Promise<void> {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = createEditorState(doc, () => {});
  ensureSyntaxTree(state, state.doc.length, 5000);
  const view = new EditorView({ state, parent });
  // Cursor on the empty last line: outside every node, so nothing is revealed.
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

describe("nested inline rendering (user-visible)", () => {
  it("hides the inner emphasis markers inside strong", async () => {
    await mount("**bold _italic_ text**\n", (p, text) => {
      expect(text).toBe("bold italic text");
      expect(p.querySelector(".cm-emphasis")).not.toBeNull();
    });
  });

  it("hides the inner strong markers inside emphasis", async () => {
    await mount("*a **b** c*\n", (_p, text) => {
      expect(text).toBe("a b c");
    });
  });

  it("hides the backticks of inline code inside emphasis", async () => {
    await mount("*a `code` b*\n", (p, text) => {
      expect(text).toBe("a code b");
      expect(p.querySelector(".cm-inline-code")).not.toBeNull();
    });
  });

  it("renders a link nested inside strong", async () => {
    await mount("**see [x](https://y.com) now**\n", (p, text) => {
      expect(text).toBe("see x now");
      expect(p.querySelector(".cm-link")).not.toBeNull();
    });
  });

  it("renders emphasis nested inside link text", async () => {
    await mount("[**bold** link](https://y.com)\n", (p, text) => {
      expect(text).toBe("bold link");
      expect(p.querySelector(".cm-emphasis")).not.toBeNull();
      expect(p.querySelector(".cm-link")).not.toBeNull();
    });
  });

  it("hides the list marker of a list inside a blockquote", async () => {
    await mount("> - a\n> - b\n", (_p, text) => {
      expect(text).toBe("a b");
    });
  });

  it("hides the inner marker of a nested blockquote", async () => {
    await mount("> a\n> > b\n", (_p, text) => {
      expect(text).toBe("a b");
    });
  });

  it("renders a heading inside a blockquote", async () => {
    await mount("> # H\n> body\n", (p, text) => {
      expect(text).toBe("H body");
      expect(p.querySelector(".cm-heading")).not.toBeNull();
    });
  });

  it("renders a fenced code block inside a blockquote", async () => {
    await mount("> ```js\n> let a=1;\n> ```\n", (p, text) => {
      expect(text).toContain("let a=1;");
      expect(text).not.toContain("```");
      expect(p.querySelector(".cm-codeblock")).not.toBeNull();
    });
  });

  it("keeps code-span content literal (nested markers must NOT render)", async () => {
    await mount("`**not bold**` end\n", (_p, text) => {
      expect(text).toBe("**not bold** end");
    });
  });

  it("uses the callout's custom title, not the type name", async () => {
    await mount("> [!note] My title\n> body text\n", (p, text) => {
      expect(p.querySelector(".cm-callout-title")?.textContent).toBe("My title");
      expect(text).toContain("body text");
    });
  });
});
