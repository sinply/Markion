import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { groupTags, TagsPanel } from "../TagsPanel";
import type { TagEntry } from "../../lib/ipc";

const entries: TagEntry[] = [
  { tag: "todo", path: "a.md", title: "a" },
  { tag: "todo", path: "notes/b.md", title: "b" },
  { tag: "idea", path: "c.md", title: "c" },
];

const spies = {
  scanTags: vi.fn().mockResolvedValue(entries),
  openNote: vi.fn().mockResolvedValue(true),
};

vi.mock("../../stores/vaultStore", () => ({
  useVaultStore: (s: any) => s({ vaultRoot: "/vault" }),
}));

vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: (s: any) => s({ showTags: true, language: "en" }),
}));

vi.mock("../../lib/ipc", () => ({
  scanTags: (...a: any[]) => spies.scanTags(...a),
}));

vi.mock("../../lib/openNote", () => ({ openNote: (...a: any[]) => spies.openNote(...a) }));

describe("groupTags", () => {
  it("groups entries by tag with deterministic file order", () => {
    const map = groupTags(entries);
    expect([...map.keys()].sort()).toEqual(["idea", "todo"]);
    expect(map.get("todo")).toEqual([
      { tag: "todo", path: "a.md", title: "a" },
      { tag: "todo", path: "notes/b.md", title: "b" },
    ]);
  });
});

describe("TagsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders tags with counts, most-used first", async () => {
    render(<TagsPanel />);
    await waitFor(() => expect(spies.scanTags).toHaveBeenCalledWith("/vault"), { timeout: 8000 });
    // todo (count 2) listed before idea (count 1)
    const rows = screen.getAllByText(/#/);
    expect(rows[0].textContent).toContain("#todo");
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("clicking a tag shows its files and clicking a file opens it", async () => {
    render(<TagsPanel />);
    await waitFor(() => expect(spies.scanTags).toHaveBeenCalled(), { timeout: 8000 });
    fireEvent.click(screen.getByText("#todo"));
    fireEvent.click(screen.getByText("b"));
    await waitFor(() => expect(spies.openNote).toHaveBeenCalledWith("/vault", "notes/b.md"), { timeout: 8000 });
  });

  it("shows the empty state when there are no tags", async () => {
    spies.scanTags.mockResolvedValueOnce([]);
    render(<TagsPanel />);
    await waitFor(() => expect(screen.getByText("No tags yet — add #tag to a note")).toBeTruthy(), { timeout: 8000 });
  });
});
