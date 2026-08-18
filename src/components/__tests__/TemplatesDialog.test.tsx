import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TemplatesDialog } from "../TemplatesDialog";
import { useUiStore } from "../../stores/uiStore";
import { useVaultStore } from "../../stores/vaultStore";
import { useSettingsStore } from "../../stores/settingsStore";

const view = {
  state: { selection: { main: { from: 12 } } },
  dispatch: vi.fn(),
  focus: vi.fn(),
};

vi.mock("../../lib/ipc", () => ({
  readFile: vi.fn().mockResolvedValue("# Meeting\nagenda\n"),
}));

vi.mock("../../lib/templates", () => ({
  listTemplates: vi.fn().mockResolvedValue([
    { name: "meeting.md", path: "Templates/meeting.md" },
    { name: "Daily.md", path: "Templates/Daily.md" },
  ]),
}));

vi.mock("../../editor/registry", () => ({
  getEditorView: () => view,
}));

import { listTemplates } from "../../lib/templates";
import { readFile } from "../../lib/ipc";

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ language: "en", templateFolder: "Templates" });
  useVaultStore.setState({ vaultRoot: "/vault" });
  useUiStore.setState({ templatesOpen: true });
});

describe("TemplatesDialog", () => {
  it("lists templates from the configured folder", async () => {
    render(<TemplatesDialog />);
    await waitFor(() => expect(screen.getByText("meeting")).toBeTruthy());
    expect(screen.getByText("Daily")).toBeTruthy();
  });

  it("inserts the chosen template at the cursor and closes", async () => {
    render(<TemplatesDialog />);
    await waitFor(() => expect(screen.getByText("meeting")).toBeTruthy());
    fireEvent.click(screen.getByText("meeting"));
    await waitFor(() => {
      expect(readFile).toHaveBeenCalledWith("/vault", "Templates/meeting.md");
      expect(view.dispatch).toHaveBeenCalledWith({
        changes: { from: 12, insert: "# Meeting\nagenda\n" },
      });
    });
    expect(useUiStore.getState().templatesOpen).toBe(false);
  });

  it("shows the empty hint when no templates exist", async () => {
    (listTemplates as any).mockResolvedValue([]);
    render(<TemplatesDialog />);
    await waitFor(() =>
      expect(screen.getByText(/No templates found/i)).toBeTruthy(),
    );
  });

  it("closes on Cancel", async () => {
    render(<TemplatesDialog />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(useUiStore.getState().templatesOpen).toBe(false);
  });

  it("renders nothing when closed", () => {
    useUiStore.setState({ templatesOpen: false });
    render(<TemplatesDialog />);
    expect(screen.queryByText("meeting")).toBeNull();
  });
});
