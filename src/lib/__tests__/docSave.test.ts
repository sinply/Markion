import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDocStore } from "../../stores/docStore";
import { useVaultStore } from "../../stores/vaultStore";
import { useUiStore } from "../../stores/uiStore";

const writeFileAtomic = vi.fn();

vi.mock("../ipc", () => ({
  writeFileAtomic: (...a: unknown[]) => writeFileAtomic(...a),
}));

import { flushDoc, flushAllDirty, flushDocsUnder } from "../docSave";

function seedVault(root: string | null) {
  // vaultStore state slice used by docSave (avoid touching localStorage logic)
  useVaultStore.setState({ vaultRoot: root });
}

describe("docSave flush helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeFileAtomic.mockResolvedValue(undefined);
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
    useUiStore.setState({ conflict: null });
    seedVault("/vault");
  });

  it("flushDoc writes the draft and marks the doc clean", async () => {
    useDocStore.getState().openDoc("a.md", "notes/a.md");
    useDocStore.getState().setDraft("notes/a.md", "typed text");
    useDocStore.getState().markDirty("notes/a.md");

    const ok = await flushDoc("notes/a.md");

    expect(ok).toBe(true);
    expect(writeFileAtomic).toHaveBeenCalledWith("/vault", "notes/a.md", "typed text");
    const s = useDocStore.getState();
    expect(s.dirtyMap["notes/a.md"]).toBe(false);
    expect(s.savedContent["notes/a.md"]).toBe("typed text");
  });

  it("flushDoc is a no-op for a clean doc", async () => {
    useDocStore.getState().openDoc("a.md", "a.md");
    const ok = await flushDoc("a.md");
    expect(ok).toBe(true);
    expect(writeFileAtomic).not.toHaveBeenCalled();
  });

  it("flushDoc refuses to guess content without a draft (failed-load docs)", async () => {
    useDocStore.getState().openDoc("a.md", "a.md");
    useDocStore.getState().markDirty("a.md"); // dirty but never had content
    const ok = await flushDoc("a.md");
    expect(ok).toBe(false);
    expect(writeFileAtomic).not.toHaveBeenCalled();
  });

  it("flushDoc skips the write while a conflict dialog is open for that path", async () => {
    useDocStore.getState().openDoc("a.md", "a.md");
    useDocStore.getState().setDraft("a.md", "mine");
    useDocStore.getState().markDirty("a.md");
    useUiStore.getState().setConflict({ path: "a.md", diskContent: "theirs" });

    const ok = await flushDoc("a.md");

    expect(ok).toBe(false);
    expect(writeFileAtomic).not.toHaveBeenCalled();
    expect(useDocStore.getState().dirtyMap["a.md"]).toBe(true);
  });

  it("flushDoc leaves the doc dirty when newer keystrokes landed during the write", async () => {
    useDocStore.getState().openDoc("a.md", "a.md");
    useDocStore.getState().setDraft("a.md", "v1");
    useDocStore.getState().markDirty("a.md");
    writeFileAtomic.mockImplementation(async () => {
      // simulate typing while the write is in flight
      useDocStore.getState().setDraft("a.md", "v2 newer");
    });

    await flushDoc("a.md");

    const s = useDocStore.getState();
    expect(s.savedContent["a.md"]).toBeUndefined();
    expect(s.dirtyMap["a.md"]).toBe(true);
  });

  it("flushAllDirty persists every dirty doc", async () => {
    for (const p of ["a.md", "b.md"]) {
      useDocStore.getState().openDoc(p, p);
      useDocStore.getState().setDraft(p, `text ${p}`);
      useDocStore.getState().markDirty(p);
    }
    await flushAllDirty();
    expect(writeFileAtomic).toHaveBeenCalledTimes(2);
    expect(useDocStore.getState().dirtyMap["a.md"]).toBe(false);
    expect(useDocStore.getState().dirtyMap["b.md"]).toBe(false);
  });

  it("flushDocsUnder only flushes docs inside the folder", async () => {
    useDocStore.getState().openDoc("root.md", "root.md");
    useDocStore.getState().openDoc("in.md", "notes/in.md");
    useDocStore.getState().openDoc("sib.md", "notes-2/sib.md");
    for (const p of ["root.md", "notes/in.md", "notes-2/sib.md"]) {
      useDocStore.getState().setDraft(p, `t ${p}`);
      useDocStore.getState().markDirty(p);
    }

    await flushDocsUnder("notes");

    expect(writeFileAtomic).toHaveBeenCalledTimes(1);
    expect(writeFileAtomic).toHaveBeenCalledWith("/vault", "notes/in.md", "t notes/in.md");
    expect(useDocStore.getState().dirtyMap["root.md"]).toBe(true);
    expect(useDocStore.getState().dirtyMap["notes-2/sib.md"]).toBe(true);
  });

  it("does nothing when no vault is open", async () => {
    seedVault(null);
    useDocStore.getState().openDoc("a.md", "a.md");
    useDocStore.getState().setDraft("a.md", "x");
    useDocStore.getState().markDirty("a.md");
    const ok = await flushDoc("a.md");
    expect(ok).toBe(false);
    expect(writeFileAtomic).not.toHaveBeenCalled();
  });
});
