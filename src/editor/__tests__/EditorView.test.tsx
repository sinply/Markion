import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MarkdownEditor } from "../EditorView";

// jsdom lacks ResizeObserver used by CM6? CM6 doesn't need it, but guard anyway.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = ResizeObserverMock;
(globalThis as any).HTMLElement.prototype.scrollTo = () => {};

// settingsStore is imported by EditorView; provide a minimal mock
vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: (selector: any) =>
    selector({ livePreview: true }),
}));

describe("MarkdownEditor mode toggle", () => {
  it("renders Edit and Preview toolbar buttons", () => {
    render(<MarkdownEditor doc="# hi" onChange={() => {}} />);
    expect(screen.getByText("✏️ Edit")).toBeTruthy();
    expect(screen.getByText("👁️ Preview")).toBeTruthy();
  });

  it("starts in live mode with Edit button active", () => {
    render(<MarkdownEditor doc="# hi" onChange={() => {}} />);
    const editBtn = screen.getByText("✏️ Edit").closest("button")!;
    expect(editBtn.className).toContain("active");
  });

  it("calls onModeChange when clicking Preview", () => {
    const onModeChange = vi.fn();
    render(
      <MarkdownEditor doc="# hi" onChange={() => {}} onModeChange={onModeChange} />,
    );
    fireEvent.click(screen.getByText("👁️ Preview").closest("button")!);
    expect(onModeChange).toHaveBeenCalledWith("preview");
  });

  it("activates Preview button after clicking it", () => {
    render(<MarkdownEditor doc="# hi" onChange={() => {}} />);
    fireEvent.click(screen.getByText("👁️ Preview").closest("button")!);
    const previewBtn = screen.getByText("👁️ Preview").closest("button")!;
    expect(previewBtn.className).toContain("active");
    const editBtn = screen.getByText("✏️ Edit").closest("button")!;
    expect(editBtn.className).not.toContain("active");
  });
});
