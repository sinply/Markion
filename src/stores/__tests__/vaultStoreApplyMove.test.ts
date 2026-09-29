import { describe, it, expect, beforeEach, vi } from "vitest";

const ipc = {
  buildTree: vi.fn(),
  reorderInFolder: vi.fn(),
  setCollapsed: vi.fn(),
  moveNode: vi.fn(),
  writeFileAtomic: vi.fn(),
  readConfig: vi.fn(),
  saveConfig: vi.fn(),
  startVaultWatch: vi.fn(),
};

// Property access is deferred into arrow functions: vi.mock factories are
// hoisted above this const, so returning `ipc` directly would throw
// "Cannot access 'ipc' before initialization".
vi.mock("../../lib/ipc", () => ({
  buildTree: (...a: unknown[]) => ipc.buildTree(...a),
  reorderInFolder: (...a: unknown[]) => ipc.reorderInFolder(...a),
  setCollapsed: (...a: unknown[]) => ipc.setCollapsed(...a),
  moveNode: (...a: unknown[]) => ipc.moveNode(...a),
  writeFileAtomic: (...a: unknown[]) => ipc.writeFileAtomic(...a),
  readConfig: (...a: unknown[]) => ipc.readConfig(...a),
  saveConfig: (...a: unknown[]) => ipc.saveConfig(...a),
  startVaultWatch: (...a: unknown[]) => ipc.startVaultWatch(...a),
}));

import { useVaultStore } from "../vaultStore";
import { useDocStore } from "../docStore";

const tree = {
  name: "vault",
  path: "",
  kind: "folder" as const,
  collapsed: false,
  children: [],
};

/**
 * Dragging a file/folder to another folder used to move it on disk while the
 * open tabs kept the OLD path: the next autosave recreated the file at its old
 * location (duplicate, newest text in the wrong place) and the moved file kept
 * stale content. applyMove must flush to the old path first, then remap tabs.
 */
describe("vaultStore.applyMove remaps open tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ipc.buildTree.mockResolvedValue(tree);
    ipc.moveNode.mockResolvedValue(undefined);
    ipc.writeFileAtomic.mockResolvedValue(undefined);
    useVaultStore.setState({ vaultRoot: "/vault", tree: null });
    useDocStore.setState({
      openDocs: [],
      activeDocId: null,
      dirtyMap: {},
      drafts: {},
      savedContent: {},
      loadErrorMap: {},
      activeContent: "",
      activeContentDocId: null,
    });
  });

  it("flushes the draft to the old path and remaps the tab", async () => {
    useDocStore.getState().openDoc("a", "notes/a.md");
    useDocStore.getState().setDraft("notes/a.md", "edited");
    useDocStore.getState().markDirty("notes/a.md");

    await useVaultStore.getState().applyMove("notes", "a.md", "archive", "a.md");

    expect(ipc.writeFileAtomic).toHaveBeenCalledWith("/vault", "notes/a.md", "edited");
    expect(ipc.moveNode).toHaveBeenCalledWith("/vault", "notes", "a.md", "archive", "a.md");
    const s = useDocStore.getState();
    expect(s.openDocs.map((d) => d.path)).toEqual(["archive/a.md"]);
    expect(s.activeDocId).toBe("archive/a.md");
    // The draft follows the tab, so the pending autosave writes the new path.
    expect(s.drafts["archive/a.md"]).toBe("edited");
    expect(s.drafts["notes/a.md"]).toBeUndefined();
  });

  it("remaps docs nested under a moved folder", async () => {
    useDocStore.getState().openDoc("x", "notes/sub/x.md");

    await useVaultStore.getState().applyMove("", "notes", "archive", "notes");

    expect(ipc.moveNode).toHaveBeenCalledWith("/vault", "", "notes", "archive", "notes");
    // The folder keeps its name, so children move with it.
    expect(useDocStore.getState().openDocs[0].path).toBe("archive/notes/sub/x.md");
  });
});
