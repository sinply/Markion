import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PropertiesDialog } from "../PropertiesDialog";
import { useUiStore } from "../../stores/uiStore";
import { useDocStore } from "../../stores/docStore";
import { useSettingsStore } from "../../stores/settingsStore";

vi.mock("../../editor/registry", () => ({
  getEditorView: vi.fn(),
}));

import { getEditorView } from "../../editor/registry";

const mockedView = vi.mocked(getEditorView);

function setActiveDoc(content: string) {
  useDocStore.setState({
    openDocs: [{ id: "a.md", path: "a.md", title: "a.md" }],
    activeDocId: "a.md",
    activeContent: content,
    activeContentDocId: "a.md",
  });
}

beforeEach(() => {
  useUiStore.setState({ propertiesOpen: true });
  useSettingsStore.setState({ language: "en" });
  mockedView.mockReset();
});

describe("PropertiesDialog", () => {
  it("loads existing frontmatter rows when opened", () => {
    setActiveDoc("---\ntitle: Hello\ntags: a, b\n---\n\nbody\n");
    render(<PropertiesDialog />);
    expect(screen.getByDisplayValue("Hello")).toBeTruthy();
    expect(screen.getByDisplayValue("a, b")).toBeTruthy();
    // both keys are visible
    expect(screen.getAllByDisplayValue("title").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByDisplayValue("tags").length).toBeGreaterThanOrEqual(1);
  });

  it("shows the empty hint when no frontmatter exists", () => {
    setActiveDoc("plain note without frontmatter\n");
    render(<PropertiesDialog />);
    expect(screen.getByText(/no properties/i)).toBeTruthy();
  });

  it("writes the edited frontmatter back through the editor view", () => {
    setActiveDoc("---\ntitle: Old\n---\n\nbody\n");
    const dispatch = vi.fn();
    mockedView.mockReturnValue({ state: { doc: { toString: () => "---\ntitle: Old\n---\n\nbody\n" } }, dispatch } as never);

    render(<PropertiesDialog />);
    const titleInput = screen.getByDisplayValue("Old");
    fireEvent.change(titleInput, { target: { value: "New" } });
    fireEvent.click(screen.getByText("Save"));

    expect(dispatch).toHaveBeenCalledTimes(1);
    const changes = dispatch.mock.calls[0][0].changes;
    expect(changes.insert).toContain("title: New");
    expect(changes.insert).toContain("---");
  });

  it("adds and removes property rows", () => {
    setActiveDoc("plain note\n");
    render(<PropertiesDialog />);
    fireEvent.click(screen.getByText("+ Add property"));
    // two inputs now: key + value of the new row
    const inputs = screen.getAllByRole("textbox");
    expect(inputs.length).toBe(2);
    fireEvent.click(screen.getByTitle("✕"));
    expect(screen.queryAllByRole("textbox").length).toBe(0);
  });
});
