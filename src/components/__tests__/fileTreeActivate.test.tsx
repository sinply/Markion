import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";

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
        { name: "index.md", path: "notes/index.md", kind: "file" as const, children: [], collapsed: false },
      ],
    },
  ],
};

/** Open tabs, mutated per test (the store mock reads this array live). */
const docs: { id: string; path: string; title: string }[] = [];
const spies = {
  readFile: vi.fn(),
  openDoc: vi.fn(),
  setActiveContent: vi.fn(),
};

vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: (selector: any) => selector({ showHiddenFiles: false }),
}));

vi.mock("../../stores/vaultStore", () => {
  const makeState = () => ({
    tree,
    vaultRoot: "/vault",
    expanded: {},
    loadTree: vi.fn(),
    applyReorder: vi.fn(),
    applyMove: vi.fn(),
    setCollapsed: vi.fn(),
  });
  return {
    useVaultStore: Object.assign((selector: any) => selector(makeState()), {
      getState: () => makeState(),
    }),
  };
});

vi.mock("../../stores/docStore", () => {
  const makeState = () => ({
    openDocs: docs,
    activeDocId: docs[0]?.id ?? null,
    dirtyMap: {},
    drafts: {},
    loadErrorMap: {},
    savedContent: {},
    openDoc: spies.openDoc,
    setActiveContent: spies.setActiveContent,
    closeDocsUnder: vi.fn(),
    renameDoc: vi.fn(),
    markSaved: vi.fn(),
    markClean: vi.fn(),
  });
  return {
    useDocStore: Object.assign((selector: any) => selector(makeState()), {
      getState: () => makeState(),
    }),
  };
});

vi.mock("../../lib/ipc", () => ({
  readFile: (...a: any[]) => spies.readFile(...a),
  createFile: vi.fn(),
  createFolder: vi.fn(),
  trashPath: vi.fn(),
  renameWithLinks: vi.fn(),
  writeFileAtomic: vi.fn(),
}));

import { FileTree } from "../FileTree";

function row(path: string): HTMLElement {
  const el = document.querySelector(`[data-path="${path}"]`);
  if (!el) throw new Error(`row not found: ${path}`);
  return el as HTMLElement;
}

/**
 * Clicking a tree row used to re-read the file from disk and push that text
 * into the doc's draft. For a file that already had a tab (dirty or not) that
 * overwrote the draft, so the pending autosave wrote the stale text back over
 * the user's edits. A tab must be activated, never re-loaded.
 */
describe("FileTree activation never clobbers an open doc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    docs.length = 0;
    spies.readFile.mockResolvedValue("stale disk text");
  });

  it("switches to an already-open file without re-reading disk", async () => {
    docs.push({ id: "intro.md", path: "intro.md", title: "intro" });
    render(<FileTree />);
    fireEvent.click(row("intro.md"));

    await waitFor(() => expect(spies.openDoc).toHaveBeenCalledWith("intro", "intro.md"));
    expect(spies.readFile).not.toHaveBeenCalled();
    expect(spies.setActiveContent).not.toHaveBeenCalled();
  });

  it("switches to an open folder index.md without re-reading disk", async () => {
    docs.push({ id: "notes/index.md", path: "notes/index.md", title: "notes" });
    render(<FileTree />);
    fireEvent.click(row("notes"));

    await waitFor(() => expect(spies.openDoc).toHaveBeenCalledWith("notes", "notes/index.md"));
    expect(spies.readFile).not.toHaveBeenCalled();
    expect(spies.setActiveContent).not.toHaveBeenCalled();
  });

  it("still reads a file that has no tab yet", async () => {
    render(<FileTree />);
    fireEvent.click(row("intro.md"));

    await waitFor(() => expect(spies.readFile).toHaveBeenCalledWith("/vault", "intro.md"));
    expect(spies.setActiveContent).toHaveBeenCalledWith("stale disk text");
  });
});
