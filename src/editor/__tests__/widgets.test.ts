import { describe, it, expect } from "vitest";
import { TaskCheckboxWidget, CodeBlockWidget, TableWidget } from "../widgets";
import type { EditorView } from "@codemirror/view";

function mockView(): EditorView {
  return { dispatch: () => {} } as unknown as EditorView;
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
  it("renders code element with language class", () => {
    const w = new CodeBlockWidget("let x = 1;", "ts");
    const dom = w.toDOM(mockView());
    const code = dom.querySelector("code")!;
    expect(code).toBeTruthy();
    // lowlight produces <span class="hljs-keyword"> etc.
    expect(code.innerHTML).toContain("let");
    expect(code.innerHTML).toContain("=");
    expect(code.innerHTML).toContain("1");
  });

  it("shows language badge", () => {
    const w = new CodeBlockWidget("code", "rust");
    const dom = w.toDOM(mockView());
    expect(dom.textContent).toContain("rust");
  });
});

describe("TableWidget", () => {
  it("renders markdown table to HTML", () => {
    const w = new TableWidget("| a | b |\n| - | - |\n| 1 | 2 |\n");
    const dom = w.toDOM(mockView());
    expect(dom.innerHTML).toContain("<table>");
  });
});
