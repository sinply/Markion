import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import { waitFor } from "@testing-library/react";
import { createEditorState } from "../codemirror";

/** Visible text of the mounted editor (what the user actually sees).
 *  jsdom does no layout, so `opacity:0` (.cm-hidden) markers still show up
 *  in textContent — remove them explicitly, plus the line-number gutter. */
function visibleText(parent: HTMLElement): string {
  const clone = parent.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".cm-hidden, .cm-gutters").forEach((el) => el.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ");
}

function mount(doc: string, cursorAt?: number): { view: EditorView; parent: HTMLElement } {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = createEditorState(doc, () => {});
  ensureSyntaxTree(state, state.doc.length, 5000);
  const view = new EditorView({ state, parent });
  if (cursorAt !== undefined) {
    view.dispatch({ selection: { anchor: Math.min(cursorAt, state.doc.length) } });
  }
  return { view, parent };
}

describe("inline markdown renders Typora-style (user-visible)", () => {
  it("**bold** hides the asterisks once the cursor leaves the pair", async () => {
    const doc = "before **bold** after\n";
    // Cursor at doc end — outside the bold node.
    const { view, parent } = mount(doc, doc.length);
    try {
      await waitFor(() => {
        expect(parent.querySelector(".cm-emphasis")).not.toBeNull();
      }, { timeout: 8000 });
      const text = visibleText(parent);
      expect(text).toContain("bold");
      expect(text).not.toContain("**");
    } finally {
      view.destroy();
      parent.remove();
    }
  });

  it("cursor INSIDE the bold pair keeps raw markers for editing", async () => {
    const doc = "before **bold** after\n";
    const inside = doc.indexOf("bol") + 1; // between b/o/l — inside the node
    const { view, parent } = mount(doc, inside);
    try {
      await waitFor(() => {
        expect(visibleText(parent)).toContain("**");
      }, { timeout: 8000 });
    } finally {
      view.destroy();
      parent.remove();
    }
  });

  it("[text](url) shows only the label — the URL must NOT be visible", async () => {
    const doc = "see [docs](https://example.com/x) here\n";
    // Cursor at the very end, outside the link node.
    const { view, parent } = mount(doc, doc.length);
    try {
      await waitFor(() => {
        expect(parent.querySelector(".cm-link")).not.toBeNull();
      }, { timeout: 8000 });
      const text = visibleText(parent);
      expect(text).toContain("docs");
      expect(text).toContain("here");
      expect(text).not.toContain("https://example.com");
    } finally {
      view.destroy();
      parent.remove();
    }
  });

  it("*italic* renders without markers when cursor is elsewhere", async () => {
    const doc = "a *it* b tail\n";
    const { view, parent } = mount(doc, doc.length);
    try {
      await waitFor(() => {
        expect(parent.querySelector(".cm-emphasis")).not.toBeNull();
      }, { timeout: 8000 });
      const text = visibleText(parent);
      expect(text).not.toContain("*");
      expect(text).toContain("it");
    } finally {
      view.destroy();
      parent.remove();
    }
  });

  it("`code` renders without backticks when cursor is elsewhere", async () => {
    const doc = "x `co` y tail\n";
    const { view, parent } = mount(doc, doc.length);
    try {
      await waitFor(() => {
        expect(parent.querySelector(".cm-inline-code")).not.toBeNull();
      }, { timeout: 8000 });
      const text = visibleText(parent);
      expect(text).not.toContain("`");
      expect(text).toContain("co");
    } finally {
      view.destroy();
      parent.remove();
    }
  });

  it("~~strike~~ hides tildes and strikes through (was never handled!)", async () => {
    const doc = "a ~~no~~ b tail\n";
    const { view, parent } = mount(doc, doc.length);
    try {
      await waitFor(() => {
        expect(parent.querySelector(".cm-strikethrough")).not.toBeNull();
      }, { timeout: 8000 });
      const text = visibleText(parent);
      expect(text).not.toContain("~~");
      expect(text).toContain("no");
    } finally {
      view.destroy();
      parent.remove();
    }
  });

  it("==highlight== hides equals signs and highlights (cursor elsewhere)", async () => {
    const doc = "a ==hi== b tail\n";
    const { view, parent } = mount(doc, doc.length);
    try {
      await waitFor(() => {
        expect(parent.innerHTML).toContain('class="cm-mark"');
      }, { timeout: 8000 });
      const text = visibleText(parent);
      expect(text).not.toContain("==");
      expect(text).toContain("hi");
    } finally {
      view.destroy();
      parent.remove();
    }
  });
});
