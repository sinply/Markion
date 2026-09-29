import { describe, it, expect, vi, beforeEach } from "vitest";
import { openNote, LARGE_FILE_BYTES, findHeadingLine } from "../openNote";
import { useDocStore } from "../../stores/docStore";
import { useUiStore } from "../../stores/uiStore";

vi.mock("../../lib/ipc", () => ({
  readFile: vi.fn(),
  fileSize: vi.fn(),
}));

import { readFile, fileSize } from "../../lib/ipc";

const mockedRead = vi.mocked(readFile);
const mockedSize = vi.mocked(fileSize);

describe("openNote", () => {
  beforeEach(() => {
    useDocStore.setState({
      openDocs: [],
      activeDocId: null,
      activeContent: "",
      dirtyMap: {},
      drafts: {},
      savedContent: {},
      loadErrorMap: {},
    });
    useUiStore.setState({ recentFiles: [] });
    mockedRead.mockReset();
    mockedSize.mockReset();
    vi.restoreAllMocks();
  });

  /**
   * Opening a note that is open as a BACKGROUND tab used to re-read it from
   * disk and push that stale text into the doc's draft — destroying unsaved
   * edits and marking the tab clean, so the autosave wrote the old text back.
   * Same defect family as the FileTree activation fix.
   */
  it("activates an already-open dirty background tab without re-reading disk", async () => {
    mockedSize.mockResolvedValue(10);
    mockedRead.mockResolvedValue("stale disk text");
    useDocStore.setState({
      openDocs: [
        { id: "dirty.md", path: "dirty.md", title: "dirty" },
        { id: "other.md", path: "other.md", title: "other" },
      ],
      activeDocId: "other.md",
      dirtyMap: { "dirty.md": true },
      drafts: { "dirty.md": "unsaved edits" },
      savedContent: { "dirty.md": "old content" },
    });

    const ok = await openNote("/vault", "dirty.md");

    expect(ok).toBe(true);
    expect(mockedRead).not.toHaveBeenCalled();
    const s = useDocStore.getState();
    expect(s.activeDocId).toBe("dirty.md");
    expect(s.drafts["dirty.md"]).toBe("unsaved edits");
    expect(s.dirtyMap["dirty.md"]).toBe(true);
  });

  it("jumps to the heading inside an already-open background tab", async () => {
    mockedSize.mockResolvedValue(10);
    mockedRead.mockResolvedValue("never read");
    useDocStore.setState({
      openDocs: [{ id: "a.md", path: "a.md", title: "a" }],
      activeDocId: null,
      dirtyMap: { "a.md": true },
      drafts: { "a.md": "# Title\n\n## Section Two\n\n" },
    });

    await openNote("/vault", "a.md", { heading: "Section Two" });

    expect(mockedRead).not.toHaveBeenCalled();
    expect(useUiStore.getState().pendingJump).toEqual({ path: "a.md", line: 3, column: 1 });
  });

  it("opens a normal-size file without prompting", async () => {
    mockedSize.mockResolvedValue(1024);
    mockedRead.mockResolvedValue("# hello");
    const confirmSpy = vi.spyOn(window, "confirm");

    const ok = await openNote("/vault", "a.md");
    expect(ok).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(useDocStore.getState().activeDocId).toBe("a.md");
    expect(useDocStore.getState().activeContent).toBe("# hello");
  });

  it("declines opening a large file when the user cancels", async () => {
    mockedSize.mockResolvedValue(LARGE_FILE_BYTES + 1);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    const ok = await openNote("/vault", "big.md");
    expect(ok).toBe(false);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mockedRead).not.toHaveBeenCalled();
    expect(useDocStore.getState().activeDocId).toBeNull();
  });

  it("opens a large file when the user confirms", async () => {
    mockedSize.mockResolvedValue(LARGE_FILE_BYTES + 1);
    mockedRead.mockResolvedValue("big content");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const ok = await openNote("/vault", "big.md");
    expect(ok).toBe(true);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(useDocStore.getState().activeContent).toBe("big content");
  });

  it("includes the file size in the warning message", async () => {
    mockedSize.mockResolvedValue(10 * 1024 * 1024);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockedRead.mockResolvedValue("x");

    await openNote("/vault", "huge.md");
    const msg = confirmSpy.mock.calls[0][0];
    expect(msg).toContain("10.0");
  });

  it("proceeds when the size check fails", async () => {
    mockedSize.mockRejectedValue(new Error("stat failed"));
    mockedRead.mockResolvedValue("content");
    const confirmSpy = vi.spyOn(window, "confirm");

    const ok = await openNote("/vault", "a.md");
    expect(ok).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("returns false when the file cannot be read", async () => {
    mockedSize.mockResolvedValue(10);
    mockedRead.mockRejectedValue(new Error("ENOENT"));

    const ok = await openNote("/vault", "missing.md");
    expect(ok).toBe(false);
  });

  it("sets a pendingJump to the heading line when opened with #anchor", async () => {
    mockedSize.mockResolvedValue(10);
    mockedRead.mockResolvedValue("# Title\n\nIntro text\n\n## Section Two\n\nBody\n");
    useUiStore.setState({ pendingJump: null });

    const ok = await openNote("/vault", "a.md", { heading: "Section Two" });
    expect(ok).toBe(true);
    expect(useUiStore.getState().pendingJump).toEqual({ path: "a.md", line: 5, column: 1 });
  });

  it("leaves pendingJump alone when the heading is missing", async () => {
    mockedSize.mockResolvedValue(10);
    mockedRead.mockResolvedValue("# Title\n");
    useUiStore.setState({ pendingJump: null });

    await openNote("/vault", "a.md", { heading: "Nope" });
    expect(useUiStore.getState().pendingJump).toBeNull();
  });
});

describe("findHeadingLine", () => {
  it("finds the 1-based line of a matching ATX heading", () => {
    const doc = "intro\n\n## Deep Dive\n\nmore\n";
    expect(findHeadingLine(doc, "Deep Dive")).toBe(3);
  });

  it("matches case-insensitively and ignores trailing # marks", () => {
    const doc = "# Title\n## My Heading ##\n";
    expect(findHeadingLine(doc, "my heading")).toBe(2);
  });

  it("skips headings inside fenced code blocks", () => {
    const doc = "```\n# fake heading\n```\n\n# real heading\n";
    expect(findHeadingLine(doc, "fake heading")).toBeNull();
    expect(findHeadingLine(doc, "real heading")).toBe(5);
  });

  it("returns null when no heading matches", () => {
    expect(findHeadingLine("plain text only", "anything")).toBeNull();
  });
});
