import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Table, TaskList, Strikethrough } from "@lezer/markdown";
import { buildDecorations } from "../livePreview";

function stateOf(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [Table, TaskList, Strikethrough] })],
  });
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

describe("buildDecorations", () => {
  it("hides bold emphasis markers (**)", () => {
    const decos = buildDecorations(stateOf("**bold** text"));
    // cm-mark class on opacity-hidden markers
    expect(countByClass(decos, "cm-mark")).toBe(2); // opening + closing **
  });

  it("hides inline code backticks", () => {
    const decos = buildDecorations(stateOf("`code` text"));
    expect(countByClass(decos, "cm-code-marker")).toBe(2); // opening + closing `
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
    const decos = buildDecorations(stateOf("# Title\n"));
    expect(countByClass(decos, "cm-heading")).toBeGreaterThan(0);
    expect(countByClass(decos, "cm-mark")).toBeGreaterThan(0); // # hidden
  });
});
