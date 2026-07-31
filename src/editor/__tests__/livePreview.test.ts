import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { buildDecorations } from "../livePreview";

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdown()] });
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

  // GFM tables and task lists are NOT decorated because the default markdown()
  // parser is CommonMark-only. GFM parser extension is planned as a follow-up.
  it("does not crash on table input (GFM not parsed yet)", () => {
    const decos = buildDecorations(stateOf("| a | b |\n| - | - |\n| 1 | 2 |\n"));
    expect(decos).toBeDefined();
    // Table is parsed as Paragraph, not replaced with widget (GFM not enabled)
  });
});
