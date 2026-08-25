import { describe, it, expect } from "vitest";
import { decideExternalChange, decideDeleted, markAppChange, recentAppChanges } from "../useExternalChanges";

describe("decideExternalChange", () => {
  it("ignores our own autosave echo (disk equals last-saved content)", () => {
    expect(decideExternalChange({ lastSaved: "hello", editor: "hello!", disk: "hello", dirty: true }))
      .toBe("ignore-echo");
  });

  it("ignores when disk matches the current editor content", () => {
    expect(decideExternalChange({ lastSaved: undefined, editor: "abc", disk: "abc", dirty: false }))
      .toBe("ignore-same");
  });

  it("surfaces a conflict when a dirty doc diverges from disk", () => {
    expect(decideExternalChange({ lastSaved: "old", editor: "mine", disk: "external", dirty: true }))
      .toBe("conflict");
  });

  it("reloads a clean doc when disk diverges", () => {
    expect(decideExternalChange({ lastSaved: "old", editor: "old", disk: "external", dirty: false }))
      .toBe("reload");
  });

  it("conflicts even without a last-saved snapshot (dirty + different)", () => {
    expect(decideExternalChange({ lastSaved: undefined, editor: "mine", disk: "external", dirty: true }))
      .toBe("conflict");
  });
});

describe("decideDeleted", () => {
  it("shows the Save As dialog for a dirty doc with editor content", () => {
    expect(decideDeleted(true, true)).toBe("dialog");
  });

  it("closes the tab for a clean doc", () => {
    expect(decideDeleted(false, true)).toBe("close");
    expect(decideDeleted(false, false)).toBe("close");
  });

  it("ignores when dirty but no editor view is available", () => {
    expect(decideDeleted(true, false)).toBe("ignore");
  });
});

describe("recentAppChanges (in-app rename/trash deletes)", () => {
  it("records a path and lets the handler suppress the matching delete", () => {
    recentAppChanges.clear();
    markAppChange("a.md");
    const since = recentAppChanges.get("a.md");
    expect(since).toBeTypeOf("number");
    // The handler treats a matching path within the window as our own rename.
    expect(recentAppChanges.has("a.md")).toBe(true);
  });
});
