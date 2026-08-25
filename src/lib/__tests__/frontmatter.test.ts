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

  it("matches an EMPTY frontmatter block", () => {
    const doc = "---\n---\n\nbody\n";
    const fm = extractFrontmatter(doc);
    expect(fm).not.toBeNull();
    expect(fm!.body).toBe("");
    expect(fm!.closed).toBe(true);
    expect(doc.slice(fm!.start, fm!.end)).toBe("---\n---\n");
  });

  it("tolerates trailing whitespace on the closing marker", () => {
    const doc = "---\nauthor: x\n--- \n\nbody\n";
    const fm = extractFrontmatter(doc);
    expect(fm).not.toBeNull();
    expect(fm!.body).toBe("author: x");
  });

  it("tolerates a leading UTF-8 BOM", () => {
    const doc = "﻿---\nauthor: x\n---\n\nbody\n";
    const fm = extractFrontmatter(doc);
    expect(fm).not.toBeNull();
    expect(fm!.body).toBe("author: x");
  });

  it("tolerates leading blank lines", () => {
    const doc = "\n\n---\nauthor: x\n---\n\nbody\n";
    const fm = extractFrontmatter(doc);
    expect(fm).not.toBeNull();
    expect(fm!.body).toBe("author: x");
  });

  it("treats an unclosed YAML run as frontmatter while typing", () => {
    const doc = "---\nauthor: sinply\ntags: FPGA";
    const fm = extractFrontmatter(doc);
    expect(fm).not.toBeNull();
    expect(fm!.closed).toBe(false);
    expect(fm!.body).toBe("author: sinply\ntags: FPGA");
  });

  it("does NOT treat a leading hr followed by a paragraph as frontmatter", () => {
    // `---` as a thematic break: no YAML `key:` line, so it must stay an hr.
    expect(extractFrontmatter("---\n\nSome paragraph\n")).toBeNull();
    expect(extractFrontmatter("---\nSome paragraph\n")).toBeNull();
    expect(extractFrontmatter("---\n\n# Heading\n")).toBeNull();
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

  it("preserves multiline list values untouched when other keys are edited", () => {
    const doc =
      "---\ntitle: A\ninbox: 2026-01-01\ntags:\n  - one\n  - two\nalias: x\n---\n\nbody\n";
    const fm = extractFrontmatter(doc)!;
    // Simulate the Properties dialog: parse -> edit title -> save.
    const props = parseFrontmatter(fm.body).map(([k, v]) =>
      k === "title" ? [k, "New"] : [k, v],
    ) as [string, string][];
    const out = replaceFrontmatter(doc, props);
    expect(out).toBe(
      "---\ntitle: New\ninbox: 2026-01-01\ntags:\n  - one\n  - two\nalias: x\n---\n\nbody\n",
    );
  });

  it("removes a key and its indented children when the row is deleted", () => {
    const doc = "---\ntags:\n  - one\n  - two\ntitle: A\n---\n\nbody\n";
    const fm = extractFrontmatter(doc)!;
    const out = replaceFrontmatter(doc, [["title", "A"]]);
    expect(out).toBe("---\ntitle: A\n---\n\nbody\n");
  });

  it("appends newly-added keys after existing multiline blocks", () => {
    const doc = "---\ntags:\n  - one\ntitle: A\n---\n\nbody\n";
    // The dialog deletes a row by omitting it from the props entirely.
    const out = replaceFrontmatter(doc, [
      ["title", "A"],
      ["date", "2026-02-02"],
    ]);
    expect(out).toBe("---\ntitle: A\ndate: 2026-02-02\n---\n\nbody\n");
  });

  it("a dialog row with a parse-flattened multiline value stays intact", () => {
    // parseFrontmatter("tags:\\n  - one") yields ["tags", ""]; saving that
    // back unchanged must NOT drop the list.
    const doc = "---\ntags:\n  - one\ntitle: A\n---\n\nbody\n";
    const out = replaceFrontmatter(doc, [
      ["tags", ""],
      ["title", "A"],
    ]);
    expect(out).toBe("---\ntags:\n  - one\ntitle: A\n---\n\nbody\n");
  });
});
