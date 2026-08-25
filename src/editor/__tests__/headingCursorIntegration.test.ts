import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import { waitFor } from "@testing-library/react";
import { createEditorState } from "../codemirror";

const DOC = `### 突发标题

| 列A | 列B |
|---|---|
| 1 | 2 |

结尾段落
`;

/** Visible text with hidden spans pruned (jsdom has no layout). */
function visibleText(parent: HTMLElement): string {
  const clone = parent.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".cm-hidden, .cm-gutters").forEach((el) => el.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ");
}

describe("INTEGRATION: heading markers track the cursor through a real view", () => {
  it("### appears when the cursor enters the heading and disappears when it leaves", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const state = createEditorState(DOC, () => {});
    ensureSyntaxTree(state, state.doc.length, 5000);
    const view = new EditorView({ state, parent });

    try {
      // 1. Cursor at the very end — heading must be RENDERED (no ###).
      view.dispatch({ selection: { anchor: DOC.length } });
      await waitFor(() => {
        expect(parent.querySelector(".cm-heading")).not.toBeNull();
      }, { timeout: 8000 });
      expect(visibleText(parent)).not.toContain("###");

      // 2. Cursor INTO the heading text — raw ### must appear.
      const inHeading = DOC.indexOf("突发") + 1;
      view.dispatch({ selection: { anchor: inHeading } });
      await waitFor(() => {
        expect(visibleText(parent)).toContain("###");
      }, { timeout: 8000 });

      // 3. Cursor to a DIFFERENT far position — ### must disappear again.
      view.dispatch({ selection: { anchor: DOC.length } });
      await waitFor(() => {
        expect(visibleText(parent)).not.toContain("###");
      }, { timeout: 8000 });
      expect(visibleText(parent)).toContain("结尾段落");

      // 4. And back once more — deterministic both directions.
      view.dispatch({ selection: { anchor: inHeading } });
      await waitFor(() => {
        expect(visibleText(parent)).toContain("###");
      }, { timeout: 8000 });
      view.dispatch({ selection: { anchor: 0 } }); // doc start = heading line start
      await waitFor(() => {
        // position 0 is INSIDE the heading node -> raw source is correct here
        expect(visibleText(parent)).toContain("###");
      }, { timeout: 8000 });
    } finally {
      view.destroy();
      parent.remove();
    }
  });
});
