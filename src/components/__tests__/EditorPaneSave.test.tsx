import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { EditorPane } from "../EditorPane";
import { useDocStore } from "../../stores/docStore";
import { useVaultStore } from "../../stores/vaultStore";
import { useUiStore } from "../../stores/uiStore";
import { getEditorView } from "../../editor/registry";
import * as ipc from "../../lib/ipc";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = ResizeObserverMock;
(globalThis as any).HTMLElement.prototype.scrollTo = () => {};

vi.mock("../../lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof ipc>();
  return {
    ...actual,
    readFile: vi.fn().mockResolvedValue("# original"),
    writeFileAtomic: vi.fn().mockResolvedValue(undefined),
  };
});

function setupStore() {
  useVaultStore.setState({ vaultRoot: "C:/vault", tree: null });
  useDocStore.setState({
    openDocs: [{ id: "a.md", path: "a.md", title: "a" }],
    activeDocId: "a.md",
    dirtyMap: {},
    savedContent: {},
    activeContent: "# original",
    activeContentDocId: "a.md",
  });
  useUiStore.setState({ conflict: null });
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  setupStore();
});

describe("EditorPane activeContent sync", () => {
  it("typing marks dirty and autosaves the CURRENT editor text", async () => {
    render(<EditorPane onHeadingsChange={() => {}} />);

    // Wait for the CM6 editor to mount.
    await waitFor(() => expect(getEditorView()).not.toBeNull(), { timeout: 5000 });

    // Type in the editor: dispatch a doc change. This fires the editor's
    // onChange -> handleChange, which marks dirty + syncs activeContent + arms
    // the 1s autosave.
    const view = getEditorView()!;
    act(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "# typed" } });
    });

    expect(useDocStore.getState().dirtyMap["a.md"]).toBe(true);
    // handleChange keeps the store's activeContent in sync immediately.
    expect(useDocStore.getState().activeContent).toBe("# typed");

    // The 1s debounce elapses; autosave writes the current content.
    await waitFor(() => expect(ipc.writeFileAtomic).toHaveBeenCalled(), { timeout: 4000 });
    expect(ipc.writeFileAtomic).toHaveBeenCalledWith("C:/vault", "a.md", "# typed");
  });

  it("does not autosave over an open external-change conflict", async () => {
    render(<EditorPane onHeadingsChange={() => {}} />);
    await waitFor(() => expect(getEditorView()).not.toBeNull(), { timeout: 5000 });

    // An external-change conflict is open for this doc.
    useUiStore.setState({ conflict: { path: "a.md", diskContent: "# disk" } });

    const view = getEditorView()!;
    act(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "# typed" } });
    });

    // Let the 1s debounce elapse: the write must be suppressed.
    await new Promise((r) => setTimeout(r, 1600));
    expect(ipc.writeFileAtomic).not.toHaveBeenCalled();
  });
});
