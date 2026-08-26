import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import { waitFor } from "@testing-library/react";
import { createEditorState } from "../codemirror";

const DOC = "```rust\nfn main() {\n    println!(\"hi\");\n}\n```\n\n正文\n";

function visibleText(parent: HTMLElement): string {
  const clone = parent.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".cm-hidden, .cm-gutters").forEach((el) => el.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ");
}

describe("rendered code blocks show a line-number gutter", () => {
  it("gutter exists with 1..N and stays beside the code (flex body)", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const state = createEditorState(DOC, () => {});
    ensureSyntaxTree(state, state.doc.length, 5000);
    const view = new EditorView({ state, parent });
    view.dispatch({ selection: { anchor: DOC.length } });
    try {
      await waitFor(() => {
        expect(parent.querySelector(".cm-codeblock")).not.toBeNull();
      }, { timeout: 8000 });

      const lines = parent.querySelector<HTMLElement>(".cm-codeblock-lines");
      expect(lines).not.toBeNull();
      // 3 code lines (fence markers excluded) -> gutter reads 1 2 3
      expect((lines!.textContent ?? "").split("\n")).toEqual(["1", "2", "3"]);
      // Structure contract: gutter + code live together in the flex body,
      // so the numbers can't drift away from the code column.
      const body = parent.querySelector(".cm-codeblock-body");
      expect(body).not.toBeNull();
      expect(body!.contains(lines!)).toBe(true);
      expect(body!.querySelector("code[contenteditable]")).not.toBeNull();
      // Gutter digits are part of the user-visible text (not display:none).
      expect(visibleText(parent)).toContain("2");
    } finally {
      view.destroy();
      parent.remove();
    }
  });
});
