import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = ResizeObserverMock;
(globalThis as any).HTMLElement.prototype.scrollTo = () => {};

const nestedTree = {
  name: "vault", path: "", kind: "folder" as const, collapsed: false,
  children: [
    { name: "intro.md", path: "intro.md", kind: "file" as const, children: [], collapsed: false },
    { name: ".env", path: ".env", kind: "file" as const, children: [], collapsed: false },
    { name: ".gitignore", path: ".gitignore", kind: "file" as const, children: [], collapsed: false },
    {
      name: "notes", path: "notes", kind: "folder" as const, collapsed: false,
      children: [
        { name: "a.md", path: "notes/a.md", kind: "file" as const, children: [], collapsed: false },
        {
          name: "deep", path: "notes/deep", kind: "folder" as const, collapsed: false,
          children: [
            { name: "x.md", path: "notes/deep/x.md", kind: "file" as const, children: [], collapsed: false },
          ],
        },
      ],
    },
  ],
};

const settingsState = { showHiddenFiles: false };
vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: (selector: any) => selector(settingsState),
}));

vi.mock("../../stores/vaultStore", () => ({
  useVaultStore: (selector: any) => selector({
    tree: nestedTree,
    vaultRoot: "/vault",
    expanded: {},
    loadTree: vi.fn(),
    applyReorder: vi.fn(),
    applyMove: vi.fn(),
    setCollapsed: vi.fn(),
  }),
}));

vi.mock("../../stores/docStore", () => ({
  useDocStore: (selector: any) => selector({
    openDocs: [],
    activeDocId: null,
    dirtyMap: {},
    openDoc: vi.fn(),
    setActiveContent: vi.fn(),
  }),
}));

vi.mock("../../lib/ipc", () => ({
  readFile: vi.fn().mockResolvedValue(""),
}));

import { FileTree } from "../FileTree";

describe("FileTree component hierarchy", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("shows top-level files/folders and HIDES collapsed subfolders by default", () => {
    render(<FileTree />);
    // Top-level items visible
    expect(screen.getByText("intro.md")).toBeTruthy();
    expect(screen.getByText("notes")).toBeTruthy();
    // Nested items hidden until folder is expanded
    expect(screen.queryByText("a.md")).toBeNull();
    expect(screen.queryByText("x.md")).toBeNull();
  });

  it("preserves nested folder data in the tree structure (expandable)", () => {
    render(<FileTree />);
    // The notes folder is rendered as a folder (📁 icon) not a flat item
    const notesRow = screen.getByText("notes").closest('[role="treeitem"]')!;
    expect(notesRow.textContent).toContain("\u{1F4C1}"); // folder icon
    expect(notesRow.textContent).toContain("▸"); // collapsed arrow indicator
  });

  it("hides dotfiles by default", () => {
    render(<FileTree />);
    expect(screen.queryByText(".env")).toBeNull();
    expect(screen.queryByText(".gitignore")).toBeNull();
  });

  it("shows dotfiles when showHiddenFiles is on", () => {
    settingsState.showHiddenFiles = true;
    render(<FileTree />);
    expect(screen.getByText(".env")).toBeTruthy();
    expect(screen.getByText(".gitignore")).toBeTruthy();
    settingsState.showHiddenFiles = false;
  });
});
