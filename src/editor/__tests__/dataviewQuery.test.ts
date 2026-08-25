import { describe, it, expect } from "vitest";
import { parseDataviewQuery, fieldValue, compareByField, type DataviewRowData } from "../dataview";

const USER_QUERY = `table file.mtime AS "修改时间", file.size AS "字节大小"
from "FPGA Notes/Study Notes/SDR软件无线电"
sort  file.name asc`;

function row(partial: Partial<DataviewRowData>): DataviewRowData {
  return {
    path: "x.md",
    name: "x",
    mtimeSecs: 1700000000,
    sizeBytes: 2048,
    values: [],
    ...partial,
  };
}

describe("parseDataviewQuery", () => {
  it("parses the user's real dataview block", () => {
    const q = parseDataviewQuery(USER_QUERY);
    expect(q).not.toBeNull();
    expect(q!.columns.map((c) => c.field)).toEqual(["file.mtime", "file.size"]);
    expect(q!.columns.map((c) => c.label)).toEqual(["修改时间", "字节大小"]);
    expect(q!.from).toBe("FPGA Notes/Study Notes/SDR软件无线电");
    expect(q!.sortField).toBe("file.name");
    expect(q!.sortDir).toBe("asc");
  });

  it("handles bare frontmatter columns and desc sort", () => {
    const q = parseDataviewQuery('table tags, status AS "状态"\nfrom "Notes"\nsort file.mtime desc');
    expect(q!.columns.map((c) => c.field)).toEqual(["tags", "status"]);
    expect(q!.sortDir).toBe("desc");
  });

  it("returns null for unsupported bodies", () => {
    expect(parseDataviewQuery("just some text")).toBeNull();
    expect(parseDataviewQuery("list from \"x\"")).toBeNull();
  });
});

describe("fieldValue / compareByField", () => {
  it("formats sizes and keeps time parts of double-space values", () => {
    expect(fieldValue(row({ sizeBytes: 2048 }), "file.size")).toBe("2.0 KB");
    const r = row({ values: [["created", "2022-08-09 20:57"]] });
    expect(fieldValue(r, "created")).toBe("2022-08-09 20:57");
    // YAML null renders as empty
    expect(fieldValue(row({ values: [["desription", "null"]] }), "desription")).toBe("");
  });

  it("sorts by name asc and mtime desc via compareByField", () => {
    const a = row({ path: "a.md", name: "a" });
    const z = row({ path: "z.md", name: "z" });
    expect(compareByField(a, z, "file.name")).toBeLessThan(0);
    const older = row({ name: "old", mtimeSecs: 100 });
    const newer = row({ name: "new", mtimeSecs: 200 });
    expect(compareByField(older, newer, "file.mtime")).toBeLessThan(0);
  });
});
