import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// jsdom lacks ResizeObserver (react-arborist uses it)
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

describe("FileTree component", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders nested folder structure with deep children", async () => {
    render(<FileTree />);
    // Top-level file
    expect(screen.getByText("intro.md")).toBeTruthy();
    // Folder
    expect(screen.getByText("notes")).toBeTruthy();
    // Child file inside folder
    expect(screen.getByText("a.md")).toBeTruthy();
    // Grandchild file inside nested folder
    expect(screen.getByText("x.md")).toBeTruthy();
  });
});
