import { describe, it, expect } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { createEditorState } from "../codemirror";

function stateOf(doc: string): EditorState {
  return createEditorState(doc, () => {});
}

describe("multiple selections", () => {
  it("allows multiple cursors (Alt+click / column select)", () => {
    const state = stateOf("aaa\nbbb\nccc\n");
    expect(state.facet(EditorState.allowMultipleSelections)).toBe(true);
  });

  it("keeps all dispatched cursor ranges instead of folding to one", () => {
    const state = stateOf("line one\nline two\nline three\n");
    const next = state.update({
      selection: EditorSelection.create([
        EditorSelection.cursor(2),
        EditorSelection.cursor(11),
        EditorSelection.cursor(21),
      ]),
    });
    expect(next.state.selection.ranges).toHaveLength(3);
    expect(next.state.selection.ranges.map((r) => r.from)).toEqual([2, 11, 21]);
  });

  it("column-select range is preserved as a multi-line selection", () => {
    const state = stateOf("abcd\nefgh\nijkl\n");
    // A vertical slice across lines 1-3 (from col 1 to col 2).
    const next = state.update({
      selection: EditorSelection.create([
        EditorSelection.range(1, 2),
        EditorSelection.range(6, 7),
        EditorSelection.range(11, 12),
      ]),
    });
    expect(next.state.selection.ranges.length).toBe(3);
    expect(next.state.selection.ranges[1].from).toBe(6);
  });
});
