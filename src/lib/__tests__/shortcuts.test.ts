import { describe, it, expect } from "vitest";
import { parseCombo, effectiveShortcuts, DEFAULT_SHORTCUTS } from "../shortcuts";

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
