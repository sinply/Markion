import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FolderContainer } from "../FolderContainer";
import { useDocStore } from "../../stores/docStore";
import { useVaultStore } from "../../stores/vaultStore";

const tree = {
  name: "vault",
  path: "",
  kind: "folder" as const,
  children: [
    {
      name: "docs",
      path: "docs",
      kind: "folder" as const,
      children: [
        { name: "index.md", path: "docs/index.md", kind: "file" as const, children: [] },
        { name: "a.md", path: "docs/a.md", kind: "file" as const, children: [] },
        { name: "sub", path: "docs/sub", kind: "folder" as const, children: [] },
      ],
    },
  ],
};

const mockOpenNote = vi.fn().mockResolvedValue(true);
vi.mock("../../lib/openNote", () => ({
  openNote: (...a: unknown[]) => mockOpenNote(...a),
}));

beforeEach(() => {
  useDocStore.setState({ openDocs: [], activeDocId: null });
  useVaultStore.setState({ vaultRoot: "/vault", tree: tree as never });
  mockOpenNote.mockClear();
});

describe("FolderContainer", () => {
  it("renders sibling notes when the active doc is an index.md", () => {
    useDocStore.setState({
      openDocs: [{ id: "docs/index.md", path: "docs/index.md", title: "index.md" }],
      activeDocId: "docs/index.md",
    });
    render(<FolderContainer />);
    expect(screen.getByText("a.md")).toBeTruthy();
    // Folder container lists only `.md` files, not subfolders or itself.
    expect(screen.queryByText("index.md")).toBeNull();
    expect(screen.queryByText("sub")).toBeNull();
  });

  it("renders nothing for a non-index note", () => {
    useDocStore.setState({
      openDocs: [{ id: "docs/a.md", path: "docs/a.md", title: "a.md" }],
      activeDocId: "docs/a.md",
    });
    const { container } = render(<FolderContainer />);
    expect(container.innerHTML).toBe("");
  });

  it("clicking a note opens it", () => {
    useDocStore.setState({
      openDocs: [{ id: "docs/index.md", path: "docs/index.md", title: "index.md" }],
      activeDocId: "docs/index.md",
    });
    render(<FolderContainer />);
    fireEvent.click(screen.getByText("a.md"));
    expect(mockOpenNote).toHaveBeenCalledWith("/vault", "docs/a.md");
  });
});