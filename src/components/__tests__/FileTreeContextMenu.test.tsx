import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Full-suite runs on slow CI/dev machines can take >1s per mocked IPC round
// trip; be generous so waitFor never flakes under load.
const WAIT = { timeout: 8000 };
// vitest's default 5s per-test timeout is shorter than WAIT: give async menu
// action tests headroom so they can't be killed while a mocked IPC chain runs.
const SLOW = 30000;

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = ResizeObserverMock;
(globalThis as any).HTMLElement.prototype.scrollTo = () => {};

const tree = {
  name: "vault", path: "", kind: "folder" as const, collapsed: false,
  children: [
    { name: "intro.md", path: "intro.md", kind: "file" as const, children: [], collapsed: false },
    {
      name: "notes", path: "notes", kind: "folder" as const, collapsed: false,
      children: [
        { name: "a.md", path: "notes/a.md", kind: "file" as const, children: [], collapsed: false },
      ],
    },
  ],
};

// Mutable action spies the component reads via getState-style selectors.
const spies = {
  loadTree: vi.fn(),
  applyMove: vi.fn(),
  openDoc: vi.fn(),
  setActiveContent: vi.fn(),
  closeDocsUnder: vi.fn(),
  renameDoc: vi.fn(),
  readFile: vi.fn().mockResolvedValue("note body"),
  createFile: vi.fn().mockResolvedValue(undefined),
  createFolder: vi.fn().mockResolvedValue(undefined),
  deletePath: vi.fn().mockResolvedValue(undefined),
  renameWithLinks: vi.fn().mockResolvedValue(0),
};

vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: (selector: any) => selector({ showHiddenFiles: false }),
}));

vi.mock("../../stores/vaultStore", () => ({
  useVaultStore: (selector: any) =>
    selector({
      tree,
      vaultRoot: "/vault",
      expanded: {},
      loadTree: spies.loadTree,
      applyReorder: vi.fn(),
      applyMove: spies.applyMove,
      setCollapsed: vi.fn(),
    }),
}));

vi.mock("../../stores/docStore", () => ({
  useDocStore: (selector: any) =>
    selector({
      openDocs: [],
      activeDocId: null,
      dirtyMap: {},
      openDoc: spies.openDoc,
      setActiveContent: spies.setActiveContent,
      closeDocsUnder: spies.closeDocsUnder,
      renameDoc: spies.renameDoc,
    }),
}));

vi.mock("../../lib/ipc", () => ({
  readFile: (...a: any[]) => spies.readFile(...a),
  createFile: (...a: any[]) => spies.createFile(...a),
  createFolder: (...a: any[]) => spies.createFolder(...a),
  deletePath: (...a: any[]) => spies.deletePath(...a),
  renameWithLinks: (...a: any[]) => spies.renameWithLinks(...a),
}));

import { FileTree } from "../FileTree";

function openMenuOn(text: string) {
  const el = screen.getByText(text);
  fireEvent.contextMenu(el, { clientX: 100, clientY: 100 });
}

describe("FileTree context menu", () => {
  // NB: use vi.stubGlobal for window.prompt/confirm/alert, NOT
  // vi.spyOn + vi.restoreAllMocks: in vitest 3.x restoreAllMocks() also
  // wipes the implementations of plain vi.fn() mocks (our module-level
  // `spies`), silently turning their return values into `undefined`.
  let promptSpy: any;
  let confirmSpy: any;
  let alertSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    promptSpy = vi.fn();
    confirmSpy = vi.fn();
    alertSpy = vi.fn();
    vi.stubGlobal("prompt", promptSpy);
    vi.stubGlobal("confirm", confirmSpy);
    vi.stubGlobal("alert", alertSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("right-clicking a file shows New Note / Rename / Delete (no New Folder)", () => {
    render(<FileTree />);
    openMenuOn("intro.md");
    const menu = screen.getByTestId("context-menu");
    const ids = [...menu.querySelectorAll("[data-menu-id]")].map(
      (el) => el.getAttribute("data-menu-id"),
    );
    expect(ids).toEqual(["new-note", "rename", "delete"]);
  });

  it("right-clicking a folder shows all four items", () => {
    render(<FileTree />);
    openMenuOn("notes");
    const menu = screen.getByTestId("context-menu");
    const ids = [...menu.querySelectorAll("[data-menu-id]")].map(
      (el) => el.getAttribute("data-menu-id"),
    );
    expect(ids).toEqual(["new-note", "new-folder", "rename", "delete"]);
  });

  it("right-clicking empty tree area offers New Note / New Folder only", () => {
    render(<FileTree />);
    // The header strip above the tree rows is not a [data-path] row.
    fireEvent.contextMenu(screen.getByText("vault"), { clientX: 5, clientY: 5 });
    const menu = screen.getByTestId("context-menu");
    const ids = [...menu.querySelectorAll("[data-menu-id]")].map(
      (el) => el.getAttribute("data-menu-id"),
    );
    expect(ids).toEqual(["new-note", "new-folder"]);
  });

  it("Escape closes the menu", () => {
    render(<FileTree />);
    openMenuOn("intro.md");
    expect(screen.getByTestId("context-menu")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("context-menu")).toBeNull();
  });

  it("New Note on a folder creates inside it and opens the note", { timeout: SLOW }, async () => {
    promptSpy.mockReturnValue("fresh");
    render(<FileTree />);
    openMenuOn("notes");
    fireEvent.click(screen.getByText("New Note"));
    await waitFor(() => expect(spies.createFile).toHaveBeenCalledWith("/vault", "notes/fresh.md"), WAIT);
    expect(spies.loadTree).toHaveBeenCalledWith("/vault");
    expect(spies.openDoc).toHaveBeenCalledWith("fresh.md", "notes/fresh.md");
    expect(spies.setActiveContent).toHaveBeenCalledWith("note body");
  });

  it("New Note on a file creates next to it (same parent)", { timeout: SLOW }, async () => {
    promptSpy.mockReturnValue("sibling");
    render(<FileTree />);
    openMenuOn("intro.md");
    fireEvent.click(screen.getByText("New Note"));
    await waitFor(() => expect(spies.createFile).toHaveBeenCalledWith("/vault", "sibling.md"), WAIT);
  });

  it("New Note rejects invalid names", () => {
    promptSpy.mockReturnValue("bad/name");
    render(<FileTree />);
    openMenuOn("intro.md");
    fireEvent.click(screen.getByText("New Note"));
    expect(alertSpy).toHaveBeenCalled();
    expect(spies.createFile).not.toHaveBeenCalled();
  });

  it("New Folder on empty area creates at vault root", { timeout: SLOW }, async () => {
    promptSpy.mockReturnValue("projects");
    render(<FileTree />);
    fireEvent.contextMenu(screen.getByText("vault"), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByText("New Folder"));
    await waitFor(() => expect(spies.createFolder).toHaveBeenCalledWith("/vault", "projects"), WAIT);
    expect(spies.loadTree).toHaveBeenCalledWith("/vault");
  });

  it("Rename on a file renames on disk and remaps the open doc", { timeout: SLOW }, async () => {
    promptSpy.mockReturnValue("renamed"); // no .md typed -> auto-appended
    render(<FileTree />);
    openMenuOn("intro.md");
    fireEvent.click(screen.getByText("Rename…"));
    await waitFor(
      () =>
        expect(spies.renameWithLinks).toHaveBeenCalledWith("/vault", "intro.md", "renamed.md"),
      WAIT,
    );
    expect(spies.renameDoc).toHaveBeenCalledWith("intro.md", "renamed.md", "renamed.md");
    expect(spies.loadTree).toHaveBeenCalledWith("/vault");
  });

  it("Rename prompts with the current name prefilled", () => {
    promptSpy.mockReturnValue(null);
    render(<FileTree />);
    openMenuOn("intro.md");
    fireEvent.click(screen.getByText("Rename…"));
    expect(promptSpy).toHaveBeenCalledWith(expect.any(String), "intro.md");
    expect(spies.renameWithLinks).not.toHaveBeenCalled();
  });

  it("Rename on a folder remaps docs under the old prefix", { timeout: SLOW }, async () => {
    promptSpy.mockReturnValue("journal");
    render(<FileTree />);
    openMenuOn("notes");
    fireEvent.click(screen.getByText("Rename…"));
    await waitFor(
      () => expect(spies.renameWithLinks).toHaveBeenCalledWith("/vault", "notes", "journal"),
      WAIT,
    );
    // No open docs in this fixture: renameDoc must not fire.
    expect(spies.renameDoc).not.toHaveBeenCalled();
  });

  it("Delete asks for confirmation and closes docs under the path", { timeout: SLOW }, async () => {
    confirmSpy.mockReturnValue(true);
    render(<FileTree />);
    openMenuOn("notes");
    fireEvent.click(screen.getByText("Delete"));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(spies.deletePath).toHaveBeenCalledWith("/vault", "notes"), WAIT);
    expect(spies.closeDocsUnder).toHaveBeenCalledWith("notes");
    expect(spies.loadTree).toHaveBeenCalledWith("/vault");
  });

  it("Delete cancelled does nothing", () => {
    confirmSpy.mockReturnValue(false);
    render(<FileTree />);
    openMenuOn("intro.md");
    fireEvent.click(screen.getByText("Delete"));
    expect(spies.deletePath).not.toHaveBeenCalled();
    expect(spies.closeDocsUnder).not.toHaveBeenCalled();
  });
});
