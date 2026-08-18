import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DeletedDialog } from "../DeletedDialog";
import { useUiStore } from "../../stores/uiStore";
import { useDocStore } from "../../stores/docStore";
import { useSettingsStore } from "../../stores/settingsStore";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("../../lib/ipc", () => ({ exportFile: vi.fn() }));

import { save } from "@tauri-apps/plugin-dialog";
import { exportFile } from "../../lib/ipc";

const mockedSave = vi.mocked(save);
const mockedExport = vi.mocked(exportFile);

describe("DeletedDialog", () => {
  beforeEach(() => {
    cleanup();
    useSettingsStore.setState({ language: "en" });
    useUiStore.setState({
      deletedDoc: { path: "notes/a.md", title: "a.md", content: "unsaved text" },
    });
    useDocStore.setState({
      openDocs: [{ id: "notes/a.md", path: "notes/a.md", title: "a.md" }],
      activeDocId: "notes/a.md",
      activeContent: "unsaved text",
      activeContentDocId: "notes/a.md",
    });
    mockedSave.mockReset();
    mockedExport.mockReset().mockResolvedValue(undefined);
  });

  it("renders nothing when no deleted doc is pending", () => {
    useUiStore.setState({ deletedDoc: null });
    const { container } = render(<DeletedDialog />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the path and the unsaved-changes warning", () => {
    render(<DeletedDialog />);
    expect(screen.getByText(/notes\/a\.md/)).toBeTruthy();
    expect(screen.getByText(/unsaved|未保存/i)).toBeTruthy();
  });

  it("saves as a new file and closes the tab", async () => {
    mockedSave.mockResolvedValue("C:/out/backup.md");
    render(<DeletedDialog />);
    fireEvent.click(screen.getByText("Save As…"));

    await vi.waitFor(() => {
      expect(mockedExport).toHaveBeenCalledWith("C:/out/backup.md", "unsaved text");
    });
    expect(useDocStore.getState().openDocs).toHaveLength(0);
    expect(useUiStore.getState().deletedDoc).toBeNull();
  });

  it("keeps the dialog open when the save is cancelled", async () => {
    mockedSave.mockResolvedValue(null as unknown as string);
    render(<DeletedDialog />);
    fireEvent.click(screen.getByText("Save As…"));

    await vi.waitFor(() => {
      expect(mockedExport).not.toHaveBeenCalled();
    });
    expect(useUiStore.getState().deletedDoc).not.toBeNull();
    expect(useDocStore.getState().openDocs).toHaveLength(1);
  });

  it("keeps the dialog open when writing fails", async () => {
    mockedSave.mockResolvedValue("C:/out/backup.md");
    mockedExport.mockRejectedValue(new Error("disk full"));
    render(<DeletedDialog />);
    fireEvent.click(screen.getByText("Save As…"));

    await vi.waitFor(() => {
      expect(mockedExport).toHaveBeenCalled();
    });
    expect(useUiStore.getState().deletedDoc).not.toBeNull();
    expect(useDocStore.getState().openDocs).toHaveLength(1);
  });

  it("discards the changes and closes the tab", () => {
    render(<DeletedDialog />);
    fireEvent.click(screen.getByText("Discard Changes"));
    expect(useDocStore.getState().openDocs).toHaveLength(0);
    expect(useUiStore.getState().deletedDoc).toBeNull();
    expect(mockedExport).not.toHaveBeenCalled();
  });
});
