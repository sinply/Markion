import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { slashCompletionSource } from "../slash";

function ctxAt(doc: string, pos: number) {
  const state = EditorState.create({ doc, extensions: [EditorView.contentAttributes.of({})] });
  return {
    state,
    pos,
    matchBefore: () => null,
    explicit: true,
  } as any;
}

describe("slashCompletionSource", () => {
  it("offers commands after a leading /", () => {
    const r = slashCompletionSource(ctxAt("/bo", 3));
    expect(r).not.toBeNull();
    expect(r!.options.some((o: any) => o.label === "Bold")).toBe(true);
    expect(r!.from).toBe(0);
  });

  it("matches / after whitespace mid-line", () => {
    const doc = "text and /he";
    const r = slashCompletionSource(ctxAt(doc, doc.length));
    expect(r).not.toBeNull();
    expect(r!.options.some((o: any) => o.label === "Heading 1")).toBe(true);
  });

  it("returns null when there is no slash", () => {
    expect(slashCompletionSource(ctxAt("plain text", 10))).toBeNull();
  });

  it("does not fire inside URLs", () => {
    const doc = "visit https://exa";
    expect(slashCompletionSource(ctxAt(doc, doc.length))).toBeNull();
    const doc2 = "see C:/fol";
    expect(slashCompletionSource(ctxAt(doc2, doc2.length))).toBeNull();
  });

  it("returns null when nothing matches", () => {
    const doc = "/zzznope";
    expect(slashCompletionSource(ctxAt(doc, doc.length))).toBeNull();
  });

  it("inserts the command text and places the cursor", () => {
    const r = slashCompletionSource(ctxAt("/", 1));
    expect(r).not.toBeNull();
    const bold = r!.options.find((o: any) => o.label === "Bold")!;
    const view = { dispatch: vi.fn(), focus: vi.fn() } as any;
    const apply = bold.apply as (v: any, c: any, f: number, t: number) => void;
    apply(view, bold, 0, 1);
    expect(view.dispatch).toHaveBeenCalledWith({
      changes: { from: 0, to: 1, insert: "****" },
      selection: { anchor: 2 },
    });
  });
});
