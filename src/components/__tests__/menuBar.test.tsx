import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MenuBar } from "../MenuBar";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../../lib/ipc", () => ({
  readRecentFiles: vi.fn().mockResolvedValue([]),
  clearRecentFiles: vi.fn(),
}));
vi.mock("../../lib/exportNote", () => ({
  exportActiveNote: vi.fn(),
  exportActivePdfFile: vi.fn(),
  exportActiveImage: vi.fn(),
}));
vi.mock("../../lib/openNote", () => ({ openNote: vi.fn() }));
vi.mock("../../lib/templates", () => ({ openDailyNote: vi.fn(), insertTemplate: vi.fn() }));

function setLanguage(lang: "zh" | "en") {
  useSettingsStore.setState({ language: lang });
}

describe("MenuBar labels (regression: renames must land in BOTH languages)", () => {
  beforeEach(() => {
    cleanup();
    useUiStore.setState({ menuOpenOverride: undefined } as never);
    useSettingsStore.setState({ showDailyNote: false });
  });

  it("Chinese: File menu shows 导出, never 另存为 / 导出", () => {
    setLanguage("zh");
    render(<MenuBar />);
    fireEvent.click(screen.getByText("文件"));
    expect(screen.getByText("导出")).toBeTruthy();
    // The standalone Save-As command (另存为…) is legitimate; the old
    // combined submenu label 另存为 / 导出 is not.
    expect(document.body.textContent).not.toContain("另存为 / 导出");
  });

  it("English: File menu shows Export, never Save As / Export", () => {
    setLanguage("en");
    render(<MenuBar />);
    fireEvent.click(screen.getByText("File"));
    const exportItems = screen.getAllByText("Export");
    expect(exportItems.length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("Save As / Export");
  });

  it("Chinese: View menu shows 专注模式, never 聚焦模式", () => {
    setLanguage("zh");
    render(<MenuBar />);
    fireEvent.click(screen.getByText("视图"));
    expect(screen.getByText("专注模式")).toBeTruthy();
    expect(document.body.textContent).not.toContain("聚焦模式");
  });

  it("English: View menu shows Focus Mode", () => {
    setLanguage("en");
    render(<MenuBar />);
    fireEvent.click(screen.getByText("View"));
    expect(screen.getByText("Focus Mode")).toBeTruthy();
  });
});
