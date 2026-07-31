import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { EditorView } from "@codemirror/view";
import { createEditorState } from "../codemirror";

const realContent = readFileSync("D:/Exercise/AI/claude-howto/CATALOG.md", "utf8");

describe("repro: real CATALOG.md in a mounted EditorView", () => {
  it("mounts an EditorView with live preview without throwing", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const state = createEditorState(realContent, () => {});
    let threw: Error | null = null;
    try {
      const view = new EditorView({ state, parent });
      // force a synchronous decorations build (what the plugin does on mount)
      view.measure();
      view.destroy();
    } catch (e: any) {
      threw = e;
    }
    expect(threw).toBeNull();
  });
});
