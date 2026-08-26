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

vi.mock("../../stores/vaultStore", () => {
  const makeState = () => ({ vaultRoot: "/vault" });
  return {
    // docSave.ts calls useVaultStore.getState(); keep the fake duck-complete.
    useVaultStore: Object.assign((s: any) => s(makeState()), {
      getState: () => makeState(),
    }),
  };
});

vi.mock("../../stores/uiStore", () => {
  const makeState = () => ({
    searchOpen: true,
    setSearchOpen: vi.fn(),
    setPendingJump: vi.fn(),
    conflict: null,
    deletedDoc: null,
    showToast: vi.fn(),
  });
  return {
    useUiStore: Object.assign((s: any) => s(makeState()), {
      getState: () => makeState(),
    }),
  };
});

vi.mock("../../stores/docStore", () => {
  const makeState = () => ({
    openDocs: [],
    activeDocId: null,
    dirtyMap: {},
    drafts: {},
    loadErrorMap: {},
    savedContent: {},
    openDoc: vi.fn(),
    setActiveContent: vi.fn(),
    markSaved: vi.fn(),
    markClean: vi.fn(),
    setDraft: vi.fn(),
  });
  return {
    useDocStore: Object.assign((s: any) => s(makeState()), {
      getState: () => makeState(),
    }),
  };
});

vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: (s: any) => s({ language: "en" }),
}));

vi.mock("../../lib/ipc", () => ({
  searchVault: (...a: any[]) => spies.searchVault(...a),
  replaceInVault: (...a: any[]) => spies.replaceInVault(...a),
  readFile: vi.fn(),
  writeFileAtomic: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/openNote", () => ({ openNote: vi.fn().mockResolvedValue(true) }));

import { SearchDialog } from "../SearchDialog";

const WAIT = { timeout: 8000 };

describe("SearchDialog regex & replace", () => {
  let confirmSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
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
