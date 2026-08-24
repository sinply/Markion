import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import { waitFor } from "@testing-library/react";
import { createEditorState } from "../codemirror";
import { skipFrontmatterCursor } from "../EditorView";

const FM_DOC = `---
author: sinply
created: 2022-03-12 22:15
class: 人文历史
description: 介绍杜甫与李白当时的生活状况以及生活背景
---

# 杜甫与李白

正文段落，讲述两位诗人的生活背景。
`;

describe("frontmatter with properties renders as card (regression)", () => {
  it("cursor at doc START (fresh open) still shows the card, not raw YAML", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const state = createEditorState(FM_DOC, () => {});
    ensureSyntaxTree(state, state.doc.length, 5000);
    const view = new EditorView({ state, parent });
    // Simulate the real open path: the component runs skipFrontmatterCursor
    // right after mounting (cursor starts at 0 = inside the frontmatter).
    skipFrontmatterCursor(view);
    try {
      await waitFor(() => {
        expect(parent.querySelector(".cm-frontmatter")).not.toBeNull();
      }, { timeout: 8000 });
      const text = parent.textContent ?? "";
      const clone = parent.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(".cm-gutters").forEach((el) => el.remove());
      const visible = (clone.textContent ?? "").replace(/\s+/g, " ");
      expect(visible).not.toContain("---");   // raw YAML fences hidden
      expect(visible).not.toContain("author:"); // raw key:value source hidden
    } finally {
      view.destroy();
      parent.remove();
    }
  });

  it("renders the Properties card and the body normally", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const state = createEditorState(FM_DOC, () => {});
    ensureSyntaxTree(state, state.doc.length, 5000);
    const view = new EditorView({ state, parent });
    view.dispatch({ selection: { anchor: state.doc.length } });
    try {
      await waitFor(() => {
        expect(parent.querySelector(".cm-frontmatter")).not.toBeNull();
      }, { timeout: 8000 });
      const text = parent.textContent ?? "";
      expect(text).toContain("author");
      expect(text).toContain("人文历史");
      expect(text).toContain("杜甫与李白");       // body heading intact
      expect(parent.querySelector(".cm-hr")).toBeNull(); // no stray rule from the --- fences
    } finally {
      view.destroy();
      parent.remove();
    }
  });
});
