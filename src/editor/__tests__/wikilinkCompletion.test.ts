import { describe, it, expect, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CompletionContext } from "@codemirror/autocomplete";
import { wikilinkCompletionSource } from "../wikilink";
import { setWikiIndex } from "../wikiIndex";

function ctxFor(doc: string): CompletionContext {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, state.doc.length, true);
}

function applyResult(doc: string, source: ReturnType<typeof wikilinkCompletionSource>) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({ state: EditorState.create({ doc }), parent });
  const result = source; // reuse
  const opt = result?.options[0];
  if (opt && typeof opt.apply === "function") {
    opt.apply(view, opt, result!.from, view.state.doc.length);
  }
  const text = view.state.doc.toString();
  view.destroy();
  document.body.removeChild(parent);
  return text;
}

describe("wikilink autocomplete", () => {
  beforeEach(() => {
    setWikiIndex([
      { name: "design.md", path: "design.md" },
      { name: "api.md", path: "notes/api.md" },
    ]);
  });

  it("offers all known stems after [[", () => {
    const result = wikilinkCompletionSource(ctxFor("text [["));
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).toEqual(["design", "api"]);
    expect(result!.options.map((o) => o.detail)).toEqual(["design.md", "notes/api.md"]);
  });

  it("filters the list by the partial target", () => {
    const result = wikilinkCompletionSource(ctxFor("text [[desi"));
    expect(result!.options.map((o) => o.label)).toEqual(["design"]);
  });

  it("adds a 'new note' entry when nothing matches", () => {
    const result = wikilinkCompletionSource(ctxFor("text [[nonexistent"));
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("New note: nonexistent");
  });

  it("inserts the target plus closing brackets on apply", () => {
    const result = wikilinkCompletionSource(ctxFor("text [[desi"));
    const out = applyResult("text [[desi", result);
    expect(out).toContain("text [[design]]");
  });

  it("returns null when not inside a wikilink", () => {
    expect(wikilinkCompletionSource(ctxFor("plain text"))).toBeNull();
    expect(wikilinkCompletionSource(ctxFor("text [[x]] done"))).toBeNull();
  });
});
