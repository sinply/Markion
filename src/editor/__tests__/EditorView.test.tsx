import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { MarkdownEditor } from "../EditorView";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = ResizeObserverMock;
(globalThis as any).HTMLElement.prototype.scrollTo = () => {};

vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: (selector: any) => selector({ livePreview: true }),
}));

vi.mock("../../stores/uiStore", () => ({
  useUiStore: (selector: any) => selector({ editorMode: "live" }),
}));

describe("MarkdownEditor", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a CM6 editor in live mode", () => {
    render(<MarkdownEditor doc="# hi" onChange={() => {}} />);
    expect(document.querySelector(".cm-editor")).toBeTruthy();
  });
});
