import { describe, it, expect } from "vitest";
import {
  isRemoteSrc,
  isAbsolutePath,
  resolveImagePath,
  imageToSrc,
  extFromType,
  isImageFile,
  imageAltFromName,
  todayStamp,
} from "../media";

const ctx = { vaultRoot: "C:/vault", docRel: "notes/sub/a.md" };

describe("isRemoteSrc", () => {
  it("matches http/https only", () => {
    expect(isRemoteSrc("https://a.com/x.png")).toBe(true);
    expect(isRemoteSrc("http://a.com/x.png")).toBe(true);
    expect(isRemoteSrc("../assets/x.png")).toBe(false);
    expect(isRemoteSrc("ftp://a.com")).toBe(false);
  });
});

describe("isAbsolutePath", () => {
  it("matches drive letters and leading slash", () => {
    expect(isAbsolutePath("C:/x.png")).toBe(true);
    expect(isAbsolutePath("C:\\x.png")).toBe(true);
    expect(isAbsolutePath("/abs/x.png")).toBe(true);
    expect(isAbsolutePath("../rel/x.png")).toBe(false);
    expect(isAbsolutePath("rel/x.png")).toBe(false);
  });
});

describe("resolveImagePath", () => {
  it("resolves a parent-relative path from the doc folder", () => {
    expect(resolveImagePath("../assets/x.png", ctx)).toBe("C:/vault/notes/assets/x.png");
  });

  it("resolves ./ and bare paths under the doc folder", () => {
    expect(resolveImagePath("./assets/x.png", ctx)).toBe("C:/vault/notes/sub/assets/x.png");
    expect(resolveImagePath("assets/x.png", ctx)).toBe("C:/vault/notes/sub/assets/x.png");
  });

  it("resolves from root-level docs", () => {
    const rootCtx = { vaultRoot: "C:/vault", docRel: "a.md" };
    expect(resolveImagePath("assets/x.png", rootCtx)).toBe("C:/vault/assets/x.png");
  });

  it("returns null for remote and data/blob", () => {
    expect(resolveImagePath("https://a.com/x.png", ctx)).toBeNull();
    expect(resolveImagePath("data:image/png;base64,xx", ctx)).toBeNull();
    expect(resolveImagePath("blob:http://x/123", ctx)).toBeNull();
  });

  it("keeps absolute paths, normalizing backslashes", () => {
    expect(resolveImagePath("C:/abs/x.png", ctx)).toBe("C:/abs/x.png");
    expect(resolveImagePath("C:\\abs\\x.png", ctx)).toBe("C:/abs/x.png");
  });

  it("normalizes a Windows backslash vaultRoot", () => {
    const winCtx = { vaultRoot: "E:\\AI\\demo-vault", docRel: "notes/a.md" };
    expect(resolveImagePath("image-11.png", winCtx)).toBe("E:/AI/demo-vault/notes/image-11.png");
    expect(resolveImagePath("../assets/x.png", winCtx)).toBe("E:/AI/demo-vault/assets/x.png");
  });

  it("decodes %20 as a space in local paths (Obsidian pasted image)", () => {
    expect(resolveImagePath("assets/Pasted%20image%2020221217210546.png", ctx))
      .toBe("C:/vault/notes/sub/assets/Pasted image 20221217210546.png");
  });

  it("decodes %20 and handles ../ with encoded names", () => {
    expect(resolveImagePath("../assets/Pasted%20image.png", ctx))
      .toBe("C:/vault/notes/assets/Pasted image.png");
  });

  it("keeps remote URLs encoded (does not decode remote)", () => {
    expect(imageToSrc("https://a.com/Pasted%20image.png", ctx))
      .toBe("https://a.com/Pasted%20image.png");
  });
});

describe("imageToSrc", () => {
  it("returns remote src unchanged", () => {
    expect(imageToSrc("https://a.com/x.png", ctx)).toBe("https://a.com/x.png");
  });

  it("returns raw src without context (convertFileSrc unavailable)", () => {
    expect(imageToSrc("img.png", undefined)).toBe("img.png");
  });

  it("resolves local paths to absolute when convertFileSrc is unavailable", () => {
    // In jsdom convertFileSrc throws -> fallback to the absolute path
    const src = imageToSrc("x.png", { vaultRoot: "C:/vault", docRel: "a.md" });
    expect(src).toBe("C:/vault/x.png");
  });
});

describe("extFromType", () => {
  it("maps common mime types", () => {
    expect(extFromType("image/jpeg")).toBe("jpg");
    expect(extFromType("image/svg+xml")).toBe("svg");
    expect(extFromType("image/png")).toBe("png");
  });

  it("falls back to the mime subtype", () => {
    expect(extFromType("image/avif")).toBe("avif");
  });

  it("falls back to the file extension then png", () => {
    expect(extFromType("", "photo.JPG")).toBe("jpg");
    expect(extFromType("", "")).toBe("png");
  });
});

describe("isImageFile", () => {
  it("only accepts image mime types", () => {
    expect(isImageFile(new File([], "a.png", { type: "image/png" }))).toBe(true);
    expect(isImageFile(new File([], "a.txt", { type: "text/plain" }))).toBe(false);
  });
});

describe("imageAltFromName", () => {
  it("strips extension and sanitizes", () => {
    expect(imageAltFromName("my image.png")).toBe("my image");
    expect(imageAltFromName("a[b]c#.png")).toBe("a-b-c-");
  });

  it("falls back to image for empty names", () => {
    expect(imageAltFromName(".png")).toBe("image");
  });
});

describe("todayStamp", () => {
  it("returns YYYYMMDD", () => {
    expect(todayStamp()).toMatch(/^\d{8}$/);
  });
});
