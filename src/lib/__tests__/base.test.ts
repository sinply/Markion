import { describe, it, expect } from "vitest";
import {
  parseBaseFile,
  serializeBaseFile,
  sortAndFilterRows,
  nextSortDir,
  dedupeRows,
  DEFAULT_SORT,
  type BaseRow,
  type BaseField,
} from "../base";

describe("parseBaseFile", () => {
  it("parses folder + field list with explicit types", () => {
    const text = [
      "folder: notes/daily",
      "fields:",
      "  - name: title",
      "    type: text",
      "  - name: count",
      "    type: number",
    ].join("\n");
    expect(parseBaseFile(text)).toEqual({
      folder: "notes/daily",
      fields: [
        { name: "title", type: "text" },
        { name: "count", type: "number" },
      ],
    });
  });

  it("defaults the field type to text when omitted", () => {
    const text = ["folder: x", "fields:", "  - name: status"].join("\n");
    const def = parseBaseFile(text);
    expect(def.folder).toBe("x");
    expect(def.fields).toEqual([{ name: "status", type: "text" }]);
  });

  it("strips surrounding quotes and tolerates comments / blanks", () => {
    const text = [
      "# a comment",
      "",
      "folder: \"notes/daily\"",
      "fields:",
      "  - name: 'tag'",
      "    type: tags",
    ].join("\n");
    expect(parseBaseFile(text)).toEqual({
      folder: "notes/daily",
      fields: [{ name: "tag", type: "tags" }],
    });
  });

  it("returns empty defaults on empty / whitespace-only input", () => {
    expect(parseBaseFile("")).toEqual({ folder: "", fields: [] });
    expect(parseBaseFile("\n\n  \n")).toEqual({ folder: "", fields: [] });
    expect(parseBaseFile("# only a comment\n")).toEqual({ folder: "", fields: [] });
  });

  it("ignores field entries with unknown types", () => {
    const text = [
      "folder: x",
      "fields:",
      "  - name: good",
      "    type: text",
      "  - name: bad",
      "    type: banana",
    ].join("\n");
    const def = parseBaseFile(text);
    expect(def.fields.map((f) => f.name)).toEqual(["good"]);
  });
});

describe("serializeBaseFile", () => {
  it("round-trips a definition with explicit types", () => {
    const def = {
      folder: "notes/daily",
      fields: [
        { name: "title", type: "text" } as BaseField,
        { name: "count", type: "number" } as BaseField,
      ],
    };
    const text = serializeBaseFile(def);
    expect(parseBaseFile(text)).toEqual(def);
  });

  it("quotes the folder path when it contains a colon", () => {
    const text = serializeBaseFile({ folder: "weird: name", fields: [] });
    expect(text).toContain('folder: "weird: name"');
    expect(parseBaseFile(text).folder).toBe("weird: name");
  });

  it("emits no fields block when there are no fields", () => {
    const text = serializeBaseFile({ folder: "x", fields: [] });
    expect(text).toBe('folder: x\n');
  });
});

describe("dedupeRows", () => {
  it("keeps the first occurrence per path and preserves order", () => {
    const rows: BaseRow[] = [
      { path: "a.md", name: "a", values: {} },
      { path: "b.md", name: "b", values: {} },
      { path: "a.md", name: "a (dup)", values: {} },
    ];
    expect(dedupeRows(rows).map((r) => r.path)).toEqual(["a.md", "b.md"]);
  });
});

describe("sortAndFilterRows", () => {
  const rows: BaseRow[] = [
    { path: "c.md", name: "Charlie", values: { tag: "fox", num: "3" } },
    { path: "a.md", name: "alpha", values: { tag: "Ant", num: "10" } },
    { path: "b.md", name: "Bravo", values: { tag: "ant", num: "2" } },
  ];

  it("keeps input order when sort.dir is null", () => {
    expect(
      sortAndFilterRows(rows, DEFAULT_SORT, {}).map((r) => r.name),
    ).toEqual(["Charlie", "alpha", "Bravo"]);
  });

  it("sorts by row title (field == \"\") ascending", () => {
    expect(
      sortAndFilterRows(rows, { field: "", dir: "asc" }, {}).map((r) => r.name),
    ).toEqual(["alpha", "Bravo", "Charlie"]);
  });

  it("sorts by a cell value descending", () => {
    // 'Ant' and 'ant' compare equal under case-insensitive sort, so the
    // stable sort preserves their input order: a.md (Ant) before b.md (ant).
    expect(
      sortAndFilterRows(rows, { field: "tag", dir: "desc" }, {}).map((r) => r.values.tag),
    ).toEqual(["fox", "Ant", "ant"]);
    expect(
      sortAndFilterRows(rows, { field: "tag", dir: "asc" }, {}).map((r) => r.values.tag),
    ).toEqual(["Ant", "ant", "fox"]);
  });

  it("filters case-insensitively by substring on each column", () => {
    expect(
      sortAndFilterRows(rows, DEFAULT_SORT, { tag: "ant" }).map((r) => r.path),
    ).toEqual(["a.md", "b.md"]);
  });

  it("ignores filters whose query is empty / whitespace", () => {
    expect(
      sortAndFilterRows(rows, DEFAULT_SORT, { tag: "   " }).map((r) => r.path),
    ).toEqual(["c.md", "a.md", "b.md"]);
  });

  it("combines filter + sort", () => {
    const out = sortAndFilterRows(
      rows,
      { field: "tag", dir: "asc" },
      { num: "10" },
    );
    expect(out.map((r) => r.path)).toEqual(["a.md"]);
  });

  it("treats missing field values as empty strings (sort and filter)", () => {
    const r: BaseRow[] = [{ path: "z.md", name: "Zeta", values: {} }];
    expect(sortAndFilterRows(r, { field: "missing", dir: "asc" }, {}).length).toBe(1);
    expect(sortAndFilterRows(r, DEFAULT_SORT, { missing: "x" }).length).toBe(0);
  });
});

describe("nextSortDir", () => {
  it("cycles null -> asc -> desc -> null", () => {
    expect(nextSortDir(null)).toBe("asc");
    expect(nextSortDir("asc")).toBe("desc");
    expect(nextSortDir("desc")).toBeNull();
  });
});
