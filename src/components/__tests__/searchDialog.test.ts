import { describe, it, expect, vi, beforeEach } from "vitest";
import { flatHits } from "../SearchDialog";
import type { SearchHit } from "../../lib/ipc";

const hit = (path: string, line: number, column: number): SearchHit => ({
  path,
  title: path.split("/").pop()?.replace(/\.md$/, "") ?? path,
  line,
  column,
  snippet: "…snippet…",
});

describe("flatHits", () => {
  it("marks the first hit of each file", () => {
    const hits = [hit("a.md", 1, 1), hit("a.md", 5, 2), hit("b.md", 1, 3)];
    const flat = flatHits(hits);
    expect(flat.map((f) => f.firstInFile)).toEqual([true, false, true]);
  });

  it("returns an empty list for no hits", () => {
    expect(flatHits([])).toEqual([]);
  });

  it("preserves order and hit identity", () => {
    const hits = [hit("a.md", 1, 1), hit("a.md", 2, 1), hit("a.md", 3, 1)];
    const flat = flatHits(hits);
    expect(flat).toHaveLength(3);
    expect(flat[2].hit.line).toBe(3);
  });
});

describe("openNote", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reads the file, opens the tab, and records it in recents", async () => {
    const ipc = await import("../../lib/ipc");
    const { openNote } = await import("../../lib/openNote");
    const readFile = vi.spyOn(ipc, "readFile").mockResolvedValue("# hello");
    const { useDocStore } = await import("../../stores/docStore");
    const { useUiStore } = await import("../../stores/uiStore");
    useDocStore.setState({ openDocs: [], activeDocId: null, activeContent: "", activeContentDocId: null });
    useUiStore.setState({ recentFiles: [] });

    const ok = await openNote("/vault", "notes/a.md");

    expect(ok).toBe(true);
    expect(readFile).toHaveBeenCalledWith("/vault", "notes/a.md");
    const doc = useDocStore.getState();
    expect(doc.openDocs).toContainEqual({ id: "notes/a.md", path: "notes/a.md", title: "a.md" });
    expect(doc.activeDocId).toBe("notes/a.md");
    expect(doc.activeContent).toBe("# hello");
    expect(useUiStore.getState().recentFiles).toContain("notes/a.md");
  });

  it("returns false when the file cannot be read", async () => {
    const ipc = await import("../../lib/ipc");
    const { openNote } = await import("../../lib/openNote");
    vi.spyOn(ipc, "readFile").mockRejectedValue(new Error("nope"));
    const ok = await openNote("/vault", "missing.md");
    expect(ok).toBe(false);
  });

  it("skips the recents update when addRecent is false", async () => {
    const ipc = await import("../../lib/ipc");
    const { openNote } = await import("../../lib/openNote");
    vi.spyOn(ipc, "readFile").mockResolvedValue("x");
    const { useUiStore } = await import("../../stores/uiStore");
    useUiStore.setState({ recentFiles: [] });
    await openNote("/vault", "a.md", { addRecent: false });
    expect(useUiStore.getState().recentFiles).toEqual([]);
  });
});
