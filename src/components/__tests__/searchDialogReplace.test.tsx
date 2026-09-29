import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const spies = {
  searchVault: vi.fn().mockResolvedValue([]),
  replaceInVault: vi.fn().mockResolvedValue({
    filesChanged: 2,
    replacements: 3,
    errors: [],
    changedPaths: [],
  }),
};

/** Shared, mutable store state so a test can stage dirty docs. */
const docState: any = {
  openDocs: [] as any[],
  activeDocId: null,
  dirtyMap: {} as Record<string, boolean>,
  drafts: {} as Record<string, string>,
  loadErrorMap: {},
  savedContent: {} as Record<string, string>,
  openDoc: vi.fn(),
  setActiveContent: vi.fn(),
  markSaved: vi.fn(),
  markClean: vi.fn(),
  setDraft: vi.fn(),
};
const uiState: any = {
  searchOpen: true,
  setSearchOpen: vi.fn(),
  setPendingJump: vi.fn(),
  conflict: null,
  deletedDoc: null,
  showToast: vi.fn(),
};
/** Reached through arrows: `vi.mock` factories are hoisted above this const. */
const ipcSpies = { writeFileAtomic: vi.fn() };

vi.mock("../../stores/vaultStore", () => {
  const makeState = () => ({ vaultRoot: "/vault" });
  return {
    // docSave.ts calls useVaultStore.getState(); keep the fake duck-complete.
    useVaultStore: Object.assign((s: any) => s(makeState()), {
      getState: () => makeState(),
    }),
  };
});

vi.mock("../../stores/uiStore", () => ({
  useUiStore: Object.assign((s: any) => s(uiState), {
    getState: () => uiState,
  }),
}));

vi.mock("../../stores/docStore", () => ({
  useDocStore: Object.assign((s: any) => s(docState), {
    getState: () => docState,
  }),
}));

vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: (s: any) => s({ language: "en" }),
}));

vi.mock("../../lib/ipc", () => ({
  searchVault: (...a: any[]) => spies.searchVault(...a),
  replaceInVault: (...a: any[]) => spies.replaceInVault(...a),
  readFile: vi.fn(),
  writeFileAtomic: (...a: any[]) => ipcSpies.writeFileAtomic(...a),
}));

vi.mock("../../lib/openNote", () => ({ openNote: vi.fn().mockResolvedValue(true) }));

import { SearchDialog } from "../SearchDialog";

const WAIT = { timeout: 8000 };

describe("SearchDialog regex & replace", () => {
  let confirmSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    docState.openDocs = [];
    docState.activeDocId = null;
    docState.dirtyMap = {};
    docState.drafts = {};
    docState.savedContent = {};
    ipcSpies.writeFileAtomic.mockReset();
    ipcSpies.writeFileAtomic.mockResolvedValue(undefined);
    confirmSpy = vi.fn();
    vi.stubGlobal("confirm", confirmSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("toggles the regex flag into the search call", async () => {
    render(<SearchDialog />);
    const input = screen.getByPlaceholderText("Search in vault…");
    fireEvent.change(input, { target: { value: "foo\\d+" } });
    // Default: literal search first.
    await waitFor(
      () => expect(spies.searchVault).toHaveBeenCalledWith("/vault", "foo\\d+", { caseSensitive: false, useRegex: false }),
      WAIT,
    );
    // Turn on regex.
    fireEvent.click(screen.getByLabelText("Regex"));
    await waitFor(
      () =>
        expect(spies.searchVault).toHaveBeenLastCalledWith("/vault", "foo\\d+", {
          caseSensitive: false,
          useRegex: true,
        }),
      WAIT,
    );
  });

  it("replace all calls replaceInVault after confirmation and reports the result", async () => {
    confirmSpy.mockReturnValue(true);
    render(<SearchDialog />);
    fireEvent.change(screen.getByPlaceholderText("Search in vault…"), {
      target: { value: "foo" },
    });
    await waitFor(() => expect(spies.searchVault).toHaveBeenCalled(), WAIT);
    fireEvent.change(screen.getByPlaceholderText("Replace with…"), {
      target: { value: "bar" },
    });
    fireEvent.click(screen.getByText("Replace all"));
    await waitFor(
      () =>
        expect(spies.replaceInVault).toHaveBeenCalledWith("/vault", "foo", "bar", {
          caseSensitive: false,
          useRegex: false,
        }),
      WAIT,
    );
    await waitFor(
      () => expect(screen.getByText("Replaced 3 occurrence(s) in 2 file(s).")).toBeTruthy(),
      WAIT,
    );
  });

  it("aborts replace-all when a dirty doc cannot be flushed", async () => {
    confirmSpy.mockReturnValue(true);
    // A doc with unsaved edits whose write fails (locked / read-only / full
    // disk). Replacing anyway would rewrite files from stale disk text and the
    // refresh loop below would overwrite — and mark clean — this very draft.
    docState.openDocs = [{ id: "locked.md", path: "locked.md", title: "locked" }];
    docState.dirtyMap = { "locked.md": true };
    docState.drafts = { "locked.md": "edited" };
    ipcSpies.writeFileAtomic.mockImplementation(async () => {
      throw new Error("EACCES");
    });

    render(<SearchDialog />);
    fireEvent.change(screen.getByPlaceholderText("Search in vault…"), {
      target: { value: "foo" },
    });
    await waitFor(() => expect(spies.searchVault).toHaveBeenCalled(), WAIT);
    fireEvent.change(screen.getByPlaceholderText("Replace with…"), {
      target: { value: "bar" },
    });
    fireEvent.click(screen.getByText("Replace all"));

    await waitFor(
      () =>
        expect(uiState.showToast).toHaveBeenCalledWith(
          expect.stringContaining("replace was cancelled"),
        ),
      WAIT,
    );
    expect(spies.replaceInVault).not.toHaveBeenCalled();
    expect(docState.drafts["locked.md"]).toBe("edited");
    expect(docState.dirtyMap["locked.md"]).toBe(true);
  });

  it("does not replace when the user cancels the confirmation", async () => {
    confirmSpy.mockReturnValue(false);
    render(<SearchDialog />);
    fireEvent.change(screen.getByPlaceholderText("Search in vault…"), {
      target: { value: "foo" },
    });
    await waitFor(() => expect(spies.searchVault).toHaveBeenCalled(), WAIT);
    fireEvent.click(screen.getByText("Replace all"));
    expect(spies.replaceInVault).not.toHaveBeenCalled();
  });

  it("disables replace all while the query is empty", () => {
    render(<SearchDialog />);
    const btn = screen.getByText("Replace all") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
