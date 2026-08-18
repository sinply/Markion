import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { createEditorState } from "../codemirror";
import { openNote } from "../../lib/openNote";

vi.mock("../../lib/openNote", () => ({ openNote: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { openUrl } from "@tauri-apps/plugin-opener";

const mockedOpenNote = vi.mocked(openNote);
const mockedOpenUrl = vi.mocked(openUrl);

function mount(doc: string, ctx: { vaultRoot: string; docRel: string }) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = createEditorState(doc, () => {}, {
    markdownContext: ctx,
    onStateChange: () => {},
  });
  const view = new EditorView({ state, parent });
  void view.contentDOM.offsetWidth;
  return { view, parent };
}

describe("internal markdown link click", () => {
  beforeEach(() => {
    mockedOpenNote.mockReset().mockResolvedValue(true);
    mockedOpenUrl.mockReset();
  });

  it("opens a relative .md link as a note", async () => {
    const doc = "See [other](notes/other.md) here\n\nAfter\n";
    const { view, parent } = mount(doc, { vaultRoot: "/vault", docRel: "a.md" });
    view.dispatch({ selection: { anchor: doc.length } }); // cursor away → link rendered
    const link = parent.querySelector(".cm-link")! as HTMLElement;
    link.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await vi.waitFor(() => {
      expect(mockedOpenNote).toHaveBeenCalledWith("/vault", "notes/other.md");
    });
    view.destroy();
    document.body.removeChild(parent);
  });

  it("resolves ../ relative to the current doc directory", async () => {
    const doc = "Back [up](../top.md)\n\nAfter\n";
    const { view, parent } = mount(doc, { vaultRoot: "/vault", docRel: "notes/sub/a.md" });
    view.dispatch({ selection: { anchor: doc.length } });
    const link = parent.querySelector(".cm-link")! as HTMLElement;
    link.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await vi.waitFor(() => {
      expect(mockedOpenNote).toHaveBeenCalledWith("/vault", "notes/top.md");
    });
    view.destroy();
    document.body.removeChild(parent);
  });

  it("keeps external links in the system browser", async () => {
    const doc = "See [web](https://example.com)\n\nAfter\n";
    const { view, parent } = mount(doc, { vaultRoot: "/vault", docRel: "a.md" });
    view.dispatch({ selection: { anchor: doc.length } });
    const link = parent.querySelector(".cm-link")! as HTMLElement;
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(mockedOpenUrl).toHaveBeenCalledWith("https://example.com");
    });
    expect(mockedOpenNote).not.toHaveBeenCalled();
    view.destroy();
    document.body.removeChild(parent);
  });

  it("ignores links to non-note files", async () => {
    const doc = "See [img](image.png)\n\nAfter\n";
    const { view, parent } = mount(doc, { vaultRoot: "/vault", docRel: "a.md" });
    view.dispatch({ selection: { anchor: doc.length } });
    const link = parent.querySelector(".cm-link")! as HTMLElement;
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // No openNote, no openUrl — default behavior (cursor placement).
    expect(mockedOpenNote).not.toHaveBeenCalled();
    expect(mockedOpenUrl).not.toHaveBeenCalled();
    view.destroy();
    document.body.removeChild(parent);
  });
});
