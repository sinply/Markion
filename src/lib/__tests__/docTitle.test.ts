import { describe, it, expect } from "vitest";
import { docTitle, titleForPath } from "../docTitle";

describe("docTitle", () => {
  it("strips a trailing .md extension", () => {
    expect(docTitle("MyNote.md")).toBe("MyNote");
    expect(docTitle("notes/MyNote.md")).toBe("MyNote");
    expect(docTitle("a/b/c.md")).toBe("c");
  });

  it("is case-insensitive on the extension", () => {
    expect(docTitle("README.MD")).toBe("README");
    expect(docTitle("x.Md")).toBe("x");
  });

  it("leaves non-md names and other extensions alone", () => {
    expect(docTitle("diagram.base")).toBe("diagram.base");
    expect(docTitle("board.canvas")).toBe("board.canvas");
    expect(docTitle("plainname")).toBe("plainname");
  });

  it("only strips the extension once", () => {
    expect(docTitle("weird.name.md")).toBe("weird.name");
  });

  it("handles empty strings", () => {
    expect(docTitle("")).toBe("");
  });
});

describe("titleForPath", () => {
  it("delegates to docTitle for normal notes", () => {
    expect(titleForPath("notes/hello.md")).toBe("hello");
  });

  it("shows an index.md as its folder name", () => {
    expect(titleForPath("docs/index.md")).toBe("docs");
    expect(titleForPath("design/index.md")).toBe("design");
  });

  it("falls back gracefully for a root-level index.md", () => {
    // no parent folder — keep at least something readable
    expect(titleForPath("index.md")).toBe("index");
  });
});
