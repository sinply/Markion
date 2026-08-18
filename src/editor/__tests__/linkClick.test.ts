import { describe, it, expect } from "vitest";
import { resolveInternalPath } from "../livePreview";

describe("resolveInternalPath", () => {
  it("resolves a sibling note relative to the current doc", () => {
    expect(resolveInternalPath("notes/a.md", "./b.md")).toBe("notes/b.md");
    expect(resolveInternalPath("a.md", "b.md")).toBe("b.md");
  });

  it("resolves ../ segments", () => {
    expect(resolveInternalPath("notes/sub/a.md", "../../top.md")).toBe("top.md");
    expect(resolveInternalPath("notes/a.md", "../b.md")).toBe("b.md");
  });

  it("treats a leading / as vault-root relative", () => {
    expect(resolveInternalPath("notes/a.md", "/root.md")).toBe("root.md");
    expect(resolveInternalPath("notes/a.md", "/docs/api.md")).toBe("docs/api.md");
  });

  it("decodes percent-escapes and strips fragments", () => {
    expect(resolveInternalPath("a.md", "./my%20note.md#section")).toBe("my note.md");
    expect(resolveInternalPath("a.md", "./b.md?raw=1")).toBe("b.md");
  });

  it("rejects non-note links", () => {
    expect(resolveInternalPath("a.md", "./image.png")).toBeNull();
    expect(resolveInternalPath("a.md", "https://x.com/a.md")).toBeNull();
    expect(resolveInternalPath("a.md", "mailto:x@y.com")).toBeNull();
  });

  it("rejects absolute OS paths (outside the vault)", () => {
    expect(resolveInternalPath("a.md", "C:/Users/me/notes/x.md")).toBeNull();
  });

  it("collapses empty segments", () => {
    expect(resolveInternalPath("", "b.md")).toBe("b.md");
    expect(resolveInternalPath("a.md", "./")).toBeNull();
  });
});
