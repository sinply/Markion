import { describe, it, expect } from "vitest";
import { decideExternalChange } from "../useExternalChanges";

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
