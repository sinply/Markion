import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import { waitFor } from "@testing-library/react";
import { createEditorState } from "../codemirror";
import { skipFrontmatterCursor } from "../EditorView";

const FM = `---
author: sinply
created:  2022-08-09 20:57
revised:  2022-08-09 20:57
tags: FPGA
desription: null
---

# FPGA学习笔记

正文内容。
`;

function visibleText(parent: HTMLElement): string {
  const clone = parent.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".cm-hidden, .cm-gutters").forEach((el) => el.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ");
}

describe("user frontmatter (double-space values, null value)", () => {
  it("opens on the Properties card with correct keys and values", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const state = createEditorState(FM, () => {});
    ensureSyntaxTree(state, state.doc.length, 5000);
    const view = new EditorView({ state, parent });
    skipFrontmatterCursor(view);
    try {
      await waitFor(() => {
        expect(parent.querySelector(".cm-frontmatter")).not.toBeNull();
      }, { timeout: 8000 });
      const cardText = parent.querySelector(".cm-frontmatter")?.textContent ?? "";
      expect(cardText).toContain("author");
      expect(cardText).toContain("sinply");
      expect(cardText).toContain("FPGA");
      // Values keep their time part despite the double space after the colon
      expect(cardText).toContain("2022-08-09 20:57");
      expect(visibleText(parent)).not.toContain("---");
      expect(visibleText(parent)).toContain("FPGA学习笔记"); // body intact
    } finally {
      view.destroy();
      parent.remove();
    }
  });
});
