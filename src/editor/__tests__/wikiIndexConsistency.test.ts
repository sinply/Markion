import { describe, it, expect, beforeEach } from "vitest";
import { setWikiIndex, resolveWikiLink, wikiStems, wikiHeading } from "../wikiIndex";

/**
 * Cross-language consistency tests.
 *
 * The wikilink matching rules live in TWO places that must stay in sync:
 * - Rust: `src-tauri/src/backlinks.rs` (`links_to`, `link_targets`)
 * - TS:   `src/editor/wikiIndex.ts` (`resolveWikiLink`, `wikiStems`)
 *
 * Each case below mirrors a `#[test]` in `backlinks.rs` (referenced in the
 * test name). If you change the matching rules on either side, update BOTH
 * the Rust tests and this file.
 */

describe("wikiIndex <-> backlinks.rs consistency", () => {
  beforeEach(() => {
    setWikiIndex([
      { name: "design.md", path: "notes/design.md" },
      { name: "other.md", path: "notes/other.md" },
      { name: "A.md", path: "a.md" },
      { name: "B.md", path: "b.md" },
    ]);
  });

  // mirrors backlinks.rs: links_to_matches_forms
  it("[[name]] resolves by stem", () => {
    expect(resolveWikiLink("design")).not.toBeNull();
  });

  it("[[path/name]] resolves by trailing stem", () => {
    expect(resolveWikiLink("notes/design")).not.toBeNull();
  });

  it("[[name|alias]] strips the alias before matching", () => {
    expect(resolveWikiLink("design|alias")).not.toBeNull();
  });

  it("[[mydesign]] does NOT resolve to 'design' (exact stem)", () => {
    expect(resolveWikiLink("mydesign")).toBeNull();
  });

  it("unknown targets do not resolve", () => {
    expect(resolveWikiLink("nope")).toBeNull();
  });

  it("matching is case-insensitive", () => {
    // mirrors backlinks.rs: links_to("[[A]] and [[B]]", "b")
    expect(resolveWikiLink("b")).not.toBeNull();
    expect(resolveWikiLink("B")).not.toBeNull();
  });

  // mirrors backlinks.rs: link_targets_extracts_stems
  it("wikiStems lists every indexed stem once", () => {
    const stems = wikiStems().map((s) => s.stem).sort();
    expect(stems).toEqual(["a", "b", "design", "other"]);
  });

  it("resolveWikiLink('path') still returns the full indexed path", () => {
    // mirrors backlinks.rs: find_backlinks resolves [[notes/design]] to
    // notes/design.md — the stem maps to the full relative path.
    expect(resolveWikiLink("design")).toBe("notes/design.md");
    expect(resolveWikiLink("notes/design")).toBe("notes/design.md");
  });

  it("blank targets never resolve", () => {
    expect(resolveWikiLink("")).toBeNull();
    expect(resolveWikiLink("  ")).toBeNull();
  });

  it("[[name#heading]] resolves by stem, ignoring the anchor", () => {
    expect(resolveWikiLink("design#Intro")).toBe("notes/design.md");
    expect(resolveWikiLink("notes/design#Intro")).toBe("notes/design.md");
    expect(resolveWikiLink("design#Intro|alias")).toBe("notes/design.md");
  });

  it("wikiHeading extracts the anchor, or null without one", () => {
    expect(wikiHeading("design#Intro")).toBe("Intro");
    expect(wikiHeading("design#My Section")).toBe("My Section");
    expect(wikiHeading("design#a#b")).toBe("a#b");
    expect(wikiHeading("design")).toBeNull();
    expect(wikiHeading("design#")).toBeNull();
    // The alias comes after the heading part
    expect(wikiHeading("design#Intro|alias")).toBe("Intro");
  });
});
