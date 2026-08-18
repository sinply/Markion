import { describe, it, expect, vi, beforeEach } from "vitest";
import { openNote, LARGE_FILE_BYTES } from "../openNote";
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
    useDocStore.setState({ openDocs: [], activeDocId: null, activeContent: "" });
    useUiStore.setState({ recentFiles: [] });
    mockedRead.mockReset();
    mockedSize.mockReset();
    vi.restoreAllMocks();
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
});
