import { describe, it, expect } from "vitest";
import {
  extractFrontmatter,
  parseFrontmatter,
  serializeFrontmatter,
  replaceFrontmatter,
} from "../frontmatter";

describe("extractFrontmatter", () => {
  it("finds a leading ---...--- block and its range", () => {
    const doc = "---\ntitle: A\ntags: x\n---\n\nbody\n";
    const fm = extractFrontmatter(doc);
    expect(fm).not.toBeNull();
    expect(fm!.body).toBe("title: A\ntags: x");
    expect(doc.slice(fm!.start, fm!.end)).toBe("---\ntitle: A\ntags: x\n---\n");
  });

  it("returns null when the doc has no frontmatter", () => {
    expect(extractFrontmatter("just a note\n")).toBeNull();
    expect(extractFrontmatter("--- not at start\n")).toBeNull();
  });
});

describe("parseFrontmatter", () => {
  it("parses top-level key: value pairs", () => {
    expect(parseFrontmatter("title: Hello\ntags: a, b\ndate: 2026-01-01\n")).toEqual([
      ["title", "Hello"],
      ["tags", "a, b"],
      ["date", "2026-01-01"],
    ]);
  });

  it("strips surrounding quotes", () => {
    expect(parseFrontmatter('title: "Quoted"\nalias: \'single\'\n')).toEqual([
      ["title", "Quoted"],
      ["alias", "single"],
    ]);
  });

  it("skips blank/comment lines", () => {
    expect(parseFrontmatter("# comment\n\nkey: v\n")).toEqual([["key", "v"]]);
  });

  it("keeps dates and numbers unquoted on round-trip", () => {
    const doc = "---\ntitle: Hello\ncount: 2\ndate: 2026-01-01\n---\n\ncontent\n";
    const fm = extractFrontmatter(doc)!;
    expect(replaceFrontmatter(doc, parseFrontmatter(fm.body))).toBe(doc);
  });
});

describe("serializeFrontmatter / replaceFrontmatter", () => {
  it("serializes into a --- block with quoting for special values", () => {
    expect(serializeFrontmatter([["title", "A"], ["note", "x: y"]]))
      .toBe('---\ntitle: A\nnote: "x: y"\n---\n');
  });

  it("replaces an existing frontmatter block", () => {
    const out = replaceFrontmatter("---\nold: 1\n---\n\nbody\n", [["new", "2"]]);
    expect(out).toBe("---\nnew: 2\n---\n\nbody\n");
  });

  it("inserts a block at the top when none exists", () => {
    const out = replaceFrontmatter("body first\n", [["title", "T"]]);
    expect(out).toBe("---\ntitle: T\n---\nbody first\n");
  });

  it("round-trips parse -> serialize", () => {
    const doc = "---\ntitle: Hello\ndate: 2026-01-01\n---\n\ncontent\n";
    const fm = extractFrontmatter(doc)!;
    const props = parseFrontmatter(fm.body);
    expect(replaceFrontmatter(doc, props)).toBe(doc);
  });
});
