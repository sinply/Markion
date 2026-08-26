import { describe, it, expect } from "vitest";
import { parseCombo, effectiveShortcuts, comboKey, findConflict, DEFAULT_SHORTCUTS } from "../shortcuts";

describe("parseCombo", () => {
  it("parses modifier + key combos", () => {
    expect(parseCombo("Ctrl+S")).toEqual({ ctrl: true, shift: false, alt: false, key: "s" });
    expect(parseCombo("Ctrl+Shift+K")).toEqual({ ctrl: true, shift: true, alt: false, key: "k" });
    expect(parseCombo("Alt+1")).toEqual({ ctrl: false, shift: false, alt: true, key: "1" });
  });

  it("accepts meta/cmd and option spellings", () => {
    expect(parseCombo("Cmd+O")?.ctrl).toBe(true);
    expect(parseCombo("Meta+O")?.ctrl).toBe(true);
    expect(parseCombo("Ctrl+Option+P")?.alt).toBe(true);
  });

  it("normalizes key case", () => {
    expect(parseCombo("Ctrl+B")?.key).toBe("b");
  });

  it("returns null for empty or keyless specs", () => {
    expect(parseCombo("")).toBeNull();
    expect(parseCombo("Ctrl+")).toBeNull();
    expect(parseCombo("Ctrl+Shift+")).toBeNull();
  });
});

describe("effectiveShortcuts", () => {
  it("merges user overrides over defaults", () => {
    const eff = effectiveShortcuts({ "md:bold": "Ctrl+Shift+B" });
    expect(eff["md:bold"]).toBe("Ctrl+Shift+B");
    expect(eff["md:italic"]).toBe(DEFAULT_SHORTCUTS["md:italic"]);
  });

  it("keeps defaults when no overrides", () => {
    expect(effectiveShortcuts({})).toEqual(DEFAULT_SHORTCUTS);
  });
});

describe("comboKey / findConflict", () => {
  it("produces a canonical key independent of spelling and order", () => {
    expect(comboKey("Ctrl+Shift+K")).toBe("ctrl+shift+k");
    expect(comboKey("shift+ctrl+k")).toBe("ctrl+shift+k");
    expect(comboKey("Cmd+O")).toBe("ctrl+o");
    expect(comboKey("")).toBeNull(); // unbound
  });

  it("detects a duplicate binding against defaults", () => {
    // Ctrl+S is app:save's default — rebinding anything else onto it clashes.
    expect(findConflict({}, "md:bold", "Ctrl+S")).toBe("app:save");
    expect(findConflict({}, "app:save", "Ctrl+S")).toBeNull(); // itself excluded
  });

  it("respects an override that freed the combo", () => {
    const overrides = { "app:save": "Ctrl+Alt+S" };
    // save moved away, so Ctrl+S is free for another command now.
    expect(findConflict(overrides, "md:bold", "Ctrl+S")).toBeNull();
    // …and its new combo is the one that now clashes.
    expect(findConflict(overrides, "md:italic", "Ctrl+Alt+S")).toBe("app:save");
  });

  it("never reports a conflict for unbound targets", () => {
    expect(findConflict({ "app:save": "" }, "md:bold", "Ctrl+S")).toBeNull();
  });
});
