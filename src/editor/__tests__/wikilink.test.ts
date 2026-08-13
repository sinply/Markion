import { describe, it, expect, beforeEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { createEditorState } from "../codemirror";
import { setWikiIndex, resolveWikiLink, wikiLabel } from "../wikiIndex";

const DOC = "Before [[design]] and [[notes/api]] and [[name|Alias]] after\n";

function mount(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({ state: createEditorState(doc, () => {}), parent });
  void view.contentDOM.offsetWidth;
  return { view, parent };
}

function wikilinks(parent: HTMLElement): HTMLElement[] {
  return Array.from(parent.querySelectorAll(".cm-wikilink"));
}

describe("wikiIndex", () => {
  beforeEach(() => {
    setWikiIndex([
      { name: "design.md", path: "design.md" },
      { name: "api.md", path: "notes/api.md" },
      { name: "Design.md", path: "docs/Design.md" },
    ]);
  });

  it("resolves a bare stem", () => {
    expect(resolveWikiLink("design")).toBe("design.md");
  });

  it("resolves a path/name by its stem", () => {
    expect(resolveWikiLink("notes/api")).toBe("notes/api.md");
  });

  it("resolves case-insensitively (first occurrence wins)", () => {
    expect(resolveWikiLink("DESIGN")).toBe("design.md");
  });

  it("strips an alias before matching", () => {
    expect(resolveWikiLink("notes/api|the api")).toBe("notes/api.md");
  });

  it("returns null for unknown targets", () => {
    expect(resolveWikiLink("missing")).toBeNull();
  });

  it("labels: alias when present, else basename", () => {
    expect(wikiLabel("notes/api")).toBe("api");
    expect(wikiLabel("name|Alias")).toBe("Alias");
    expect(wikiLabel("design")).toBe("design");
  });
});

describe("wikilink rendering", () => {
  beforeEach(() => {
    setWikiIndex([
      { name: "design.md", path: "design.md" },
      { name: "api.md", path: "notes/api.md" },
    ]);
  });

  it("renders a resolved wikilink with the basename", () => {
    const { view, parent } = mount(DOC);
    view.dispatch({ selection: { anchor: DOC.length } });
    const links = wikilinks(parent);
    expect(links.length).toBe(3);
    expect(links[0].textContent).toBe("design");
    expect(links[0].classList.contains("cm-wikilink-unresolved")).toBe(false);
    view.destroy();
    document.body.removeChild(parent);
  });

  it("renders an alias as the visible text", () => {
    const { view, parent } = mount(DOC);
    view.dispatch({ selection: { anchor: DOC.length } });
    const links = wikilinks(parent);
    expect(links[2].textContent).toBe("Alias");
    view.destroy();
    document.body.removeChild(parent);
  });

  it("marks an unresolved link with cm-wikilink-unresolved", () => {
    const doc = "See [[missing]] here\n";
    const { view, parent } = mount(doc);
    view.dispatch({ selection: { anchor: doc.length } });
    const links = wikilinks(parent);
    expect(links.length).toBe(1);
    expect(links[0].classList.contains("cm-wikilink-unresolved")).toBe(true);
    view.destroy();
    document.body.removeChild(parent);
  });

  it("does NOT render [[ inside fenced code", () => {
    const doc = "```\n[[not-a-link]]\n```\n\nAfter\n";
    const { view, parent } = mount(doc);
    view.dispatch({ selection: { anchor: doc.length } });
    expect(wikilinks(parent).length).toBe(0);
    view.destroy();
    document.body.removeChild(parent);
  });

  it("does NOT render [[ inside inline code", () => {
    const doc = "Use `[[x]]` inline\n\nAfter\n";
    const { view, parent } = mount(doc);
    view.dispatch({ selection: { anchor: doc.length } });
    expect(wikilinks(parent).length).toBe(0);
    view.destroy();
    document.body.removeChild(parent);
  });

  it("keeps the wikilink as editable source on the active line", () => {
    const { view, parent } = mount("Cursor here: [[design]]\n");
    // Cursor stays on line 1 (default) → no widget, raw source visible.
    expect(wikilinks(parent).length).toBe(0);
    view.destroy();
    document.body.removeChild(parent);
  });
});
