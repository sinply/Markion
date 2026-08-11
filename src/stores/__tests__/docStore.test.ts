import { describe, it, expect, beforeEach } from "vitest";
import { useDocStore } from "../docStore";

describe("docStore", () => {
  beforeEach(() => {
    useDocStore.setState({ openDocs: [], activeDocId: null, dirtyMap: {}, activeContent: "", activeContentDocId: null });
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
});
