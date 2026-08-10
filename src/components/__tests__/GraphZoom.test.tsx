import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { GraphPanel } from "../GraphPanel";

// Mock stores + ipc so GraphPanel can mount without Tauri.
const mockNodes = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}.md`, title: `n${i}` }));
const mockEdges = mockNodes.slice(1).map((n, i) => ({ source: mockNodes[i].id, target: n.id }));

vi.mock("../../stores/vaultStore", () => ({
  useVaultStore: (sel: any) =>
    sel({ vaultRoot: "C:/demo", tree: null, expanded: {}, loadTree: vi.fn(), applyReorder: vi.fn(), applyMove: vi.fn(), setCollapsed: vi.fn() }),
}));
vi.mock("../../stores/docStore", () => ({
  useDocStore: (sel: any) =>
    sel({ openDocs: [], activeDocId: null, dirtyMap: {}, openDoc: vi.fn(), setActiveContent: vi.fn() }),
}));
vi.mock("../../lib/ipc", () => ({
  scanGraph: async () => [mockNodes, mockEdges],
  readFile: async () => "# x",
}));

describe("GraphPanel zoom", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders zoom in/out/reset buttons", async () => {
    const { findByTitle } = render(<GraphPanel />);
    expect(await findByTitle("Zoom in")).toBeTruthy();
    expect(await findByTitle("Zoom out")).toBeTruthy();
    expect(await findByTitle("Reset")).toBeTruthy();
  });

  it("zoom in increases the group transform scale", async () => {
    const { findByTitle, container } = render(<GraphPanel />);
    await findByTitle("Zoom in");
    const g = container.querySelector("svg g")!;
    const before = g.getAttribute("transform");
    fireEvent.click(await findByTitle("Zoom in"));
    const after = g.getAttribute("transform");
    expect(before).toBeTruthy();
    expect(after).toBeTruthy();
    expect(after).not.toBe(before); // transform changed
  });
});
