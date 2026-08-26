import { describe, it, expect, beforeEach } from "vitest";
import { useDocStore } from "../docStore";

describe("docStore", () => {
  beforeEach(() => {
    useDocStore.setState({
      openDocs: [],
      activeDocId: null,
      dirtyMap: {},
      activeContent: "",
      activeContentDocId: null,
      savedContent: {},
      drafts: {},
      loadErrorMap: {},
    });
  });

  it("openDoc adds a document and sets it active", () => {
    useDocStore.getState().openDoc("intro.md", "notes/intro.md");
    const { openDocs, activeDocId } = useDocStore.getState();
    expect(openDocs).toHaveLength(1);
    expect(openDocs[0].path).toBe("notes/intro.md");
    expect(openDocs[0].title).toBe("intro.md");
    expect(activeDocId).toBe("notes/intro.md");
  });

  it("openDoc does not duplicate an already-open doc", () => {
    useDocStore.getState().openDoc("a.md", "a.md");
    useDocStore.getState().openDoc("a.md", "a.md");
    expect(useDocStore.getState().openDocs).toHaveLength(1);
  });

  it("closeDoc removes the doc and activates the next one", () => {
    useDocStore.getState().openDoc("a.md", "a.md");
    useDocStore.getState().openDoc("b.md", "b.md");
    const firstId = useDocStore.getState().openDocs[0].id;
    useDocStore.getState().closeDoc(firstId);
    const { openDocs, activeDocId } = useDocStore.getState();
    expect(openDocs).toHaveLength(1);
    expect(activeDocId).toBe("b.md");
  });

  it("markDirty / markClean toggles dirty state", () => {
    useDocStore.getState().openDoc("a.md", "a.md");
    const id = useDocStore.getState().activeDocId!;
    useDocStore.getState().markDirty(id);
    expect(useDocStore.getState().dirtyMap[id]).toBe(true);
    useDocStore.getState().markClean(id);
    expect(useDocStore.getState().dirtyMap[id]).toBe(false);
  });

  it("switchTo changes active doc", () => {
    useDocStore.getState().openDoc("a.md", "a.md");
    useDocStore.getState().openDoc("b.md", "b.md");
    const docs = useDocStore.getState().openDocs;
    useDocStore.getState().switchTo(docs[0].id);
    expect(useDocStore.getState().activeDocId).toBe(docs[0].id);
  });

  it("setActiveContent records which doc the content belongs to", () => {
    useDocStore.getState().openDoc("a.md", "a.md");
    useDocStore.getState().setActiveContent("content A");
    expect(useDocStore.getState().activeContentDocId).toBe("a.md");
  });

  it("closing the active doc clears stale content so the editor reloads", () => {
    useDocStore.getState().openDoc("a.md", "a.md");
    useDocStore.getState().setActiveContent("content A");
    useDocStore.getState().openDoc("b.md", "b.md");
    useDocStore.getState().setActiveContent("content B");
    // Now close b (active) — content for b is stale, must clear.
    useDocStore.getState().closeDoc("b.md");
    const s = useDocStore.getState();
    expect(s.activeDocId).toBe("a.md");
    expect(s.activeContent).toBe("");
    expect(s.activeContentDocId).toBeNull();
  });

  describe("closeDocsUnder", () => {
    beforeEach(() => {
      useDocStore.getState().openDoc("a.md", "a.md");
      useDocStore.getState().openDoc("n1.md", "notes/n1.md");
      useDocStore.getState().openDoc("n2.md", "notes/deep/n2.md");
      useDocStore.getState().openDoc("notes-2.md", "notes-2.md");
    });

    it("closes docs at and under the folder path", () => {
      useDocStore.getState().closeDocsUnder("notes");
      const paths = useDocStore.getState().openDocs.map((d) => d.path);
      expect(paths).toEqual(["a.md", "notes-2.md"]);
    });

    it("does not prefix-match sibling folders (notes vs notes-2)", () => {
      useDocStore.getState().closeDocsUnder("notes-2");
      const paths = useDocStore.getState().openDocs.map((d) => d.path);
      expect(paths).toContain("notes/n1.md");
      expect(paths).toContain("notes/deep/n2.md");
    });

    it("activates a remaining doc when the active one is closed", () => {
      useDocStore.getState().switchTo("notes/deep/n2.md");
      useDocStore.getState().setActiveContent("content");
      useDocStore.getState().closeDocsUnder("notes");
      const s = useDocStore.getState();
      expect(s.activeDocId).toBe("notes-2.md");
      expect(s.activeContent).toBe("");
      expect(s.activeContentDocId).toBeNull();
    });

    it("is a no-op when nothing matches", () => {
      const before = useDocStore.getState().openDocs;
      useDocStore.getState().closeDocsUnder("empty");
      expect(useDocStore.getState().openDocs).toBe(before);
    });
  });

  describe("renameDoc", () => {
    it("moves path/title/id and remaps saved/dirty maps", () => {
      useDocStore.getState().openDoc("old.md", "dir/old.md");
      useDocStore.getState().markDirty("dir/old.md");
      useDocStore.getState().markSaved("dir/old.md", "saved content");
      useDocStore.getState().renameDoc("dir/old.md", "dir/new.md", "new.md");
      const s = useDocStore.getState();
      expect(s.openDocs).toHaveLength(1);
      expect(s.openDocs[0]).toEqual({ id: "dir/new.md", path: "dir/new.md", title: "new.md" });
      expect(s.activeDocId).toBe("dir/new.md");
      expect(s.dirtyMap["dir/new.md"]).toBe(true);
      expect(s.dirtyMap["dir/old.md"]).toBeUndefined();
      expect(s.savedContent["dir/new.md"]).toBe("saved content");
    });

    it("keeps activeContentDocId pointing at the renamed doc", () => {
      useDocStore.getState().openDoc("old.md", "old.md");
      useDocStore.getState().setActiveContent("text");
      useDocStore.getState().renameDoc("old.md", "new.md", "new.md");
      const s = useDocStore.getState();
      expect(s.activeContentDocId).toBe("new.md");
      expect(s.activeContent).toBe("text");
    });

    it("does nothing when the doc is not open", () => {
      useDocStore.getState().openDoc("a.md", "a.md");
      useDocStore.getState().renameDoc("missing.md", "other.md", "other.md");
      expect(useDocStore.getState().openDocs[0].path).toBe("a.md");
    });
  });
});

describe("docStore drafts (per-doc unsaved content)", () => {
  beforeEach(() => {
    useDocStore.setState({
      openDocs: [],
      activeDocId: null,
      dirtyMap: {},
      activeContent: "",
      activeContentDocId: null,
      savedContent: {},
      drafts: {},
      loadErrorMap: {},
    });
  });

  it("setDraft records per-doc content and mirrors the active doc into activeContent", () => {
    useDocStore.getState().openDoc("a.md", "a.md");
    useDocStore.getState().openDoc("b.md", "b.md");
    useDocStore.getState().setDraft("a.md", "typed in a");
    // b is active — a's draft must NOT leak into activeContent.
    expect(useDocStore.getState().activeContent).toBe("");
    useDocStore.getState().switchTo("a.md");
    useDocStore.getState().setDraft("a.md", "typed more in a");
    const s = useDocStore.getState();
    expect(s.drafts["a.md"]).toBe("typed more in a");
    expect(s.activeContent).toBe("typed more in a");
    expect(s.activeContentDocId).toBe("a.md");
  });

  it("setActiveContent seeds the draft of the active doc (open/load path)", () => {
    useDocStore.getState().openDoc("a.md", "a.md");
    useDocStore.getState().setActiveContent("loaded from disk");
    expect(useDocStore.getState().drafts["a.md"]).toBe("loaded from disk");
  });

  it("markSaved syncs the draft to the written bytes", () => {
    useDocStore.getState().openDoc("a.md", "a.md");
    useDocStore.getState().setDraft("a.md", "v1");
    useDocStore.getState().setDraft("a.md", "v2 during write");
    useDocStore.getState().markSaved("a.md", "older write");
    // markSaved reflects the bytes actually written; a newer keystroke after
    // it re-dirties via setDraft, so this ordering is observable here.
    expect(useDocStore.getState().drafts["a.md"]).toBe("older write");
  });

  it("renameDoc moves the draft and loadError to the new key", () => {
    useDocStore.getState().openDoc("old.md", "old.md");
    useDocStore.getState().setDraft("old.md", "pending text");
    useDocStore.getState().setLoadError("old.md", true);
    useDocStore.getState().renameDoc("old.md", "new.md", "new.md");
    const s = useDocStore.getState();
    expect(s.drafts["new.md"]).toBe("pending text");
    expect(s.drafts["old.md"]).toBeUndefined();
    expect(s.loadErrorMap["new.md"]).toBe(true);
  });

  it("closeDoc / closeDocsUnder / reset drop their drafts and load errors", () => {
    useDocStore.getState().openDoc("a.md", "a.md");
    useDocStore.getState().openDoc("n.md", "notes/n.md");
    useDocStore.getState().setDraft("a.md", "da");
    useDocStore.getState().setDraft("notes/n.md", "dn");
    useDocStore.getState().setLoadError("notes/n.md", true);
    useDocStore.getState().closeDocsUnder("notes");
    let s = useDocStore.getState();
    expect(s.drafts).toEqual({ "a.md": "da" });
    expect(s.loadErrorMap["notes/n.md"]).toBeUndefined();
    useDocStore.getState().closeDoc("a.md");
    s = useDocStore.getState();
    expect(s.drafts).toEqual({});
    useDocStore.getState().reset();
    s = useDocStore.getState();
    expect(s.drafts).toEqual({});
    expect(s.loadErrorMap).toEqual({});
  });
});
