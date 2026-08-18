import { describe, it, expect, vi, beforeEach } from "vitest";

// vitest stubs CSS imports as empty (css: false); the ?raw import works in the
// real Vite build. Mock it with representative content for the assertions.
vi.mock("katex/dist/katex.min.css?raw", () => ({ default: ".katex{color:red}" }));

vi.mock("../ipc", () => ({
  exportFile: vi.fn().mockResolvedValue(undefined),
  readFileBase64: vi.fn().mockResolvedValue("QUJDRA=="),
}));

import { buildExportHtml, inlineImages, printHtml } from "../exportNote";
import { readFileBase64 } from "../ipc";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildExportHtml", () => {
  it("wraps the document in a standalone HTML page with the title", async () => {
    const html = await buildExportHtml("# Hello\n\nWorld.", "hello.md");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>hello.md</title>");
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<p>World.</p>");
    // KaTeX stylesheet inlined (self-contained, no external dependency)
    expect(html).toContain(".katex");
  });

  it("escapes the title", async () => {
    const html = await buildExportHtml("x", "<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("renders tables, task lists, and code highlighting", async () => {
    const html = await buildExportHtml(
      "| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n\n```ts\nconst x: number = 1;\n```\n",
      "t.md",
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<input");
    expect(html).toContain("hljs"); // highlight.js spans
  });

  it("renders block and inline math via KaTeX", async () => {
    const html = await buildExportHtml(
      "Inline $x^2$ and block:\n\n$$\n\\int_0^1 x dx\n$$\n",
      "m.md",
    );
    expect(html).toContain("katex");
    expect(html).toContain("msup"); // superscript structure from x^2
    expect(html).not.toContain("$x^2$");
  });

  it("protects math content from markdown-it interpretation", async () => {
    // `$a*b$` must NOT be parsed as italics — the whole run is math.
    const html = await buildExportHtml("$a*b$", "m.md");
    expect(html).toContain("katex");
    expect(html).not.toContain("<em>");
  });

  it("falls back mermaid fences to source code blocks", async () => {
    const html = await buildExportHtml("```mermaid\ngraph TD;\n  A-->B;\n```\n", "d.md");
    expect(html).toContain('<pre><code class="language-mermaid">graph TD;');
    expect(html).not.toContain("cm-mermaid-pending");
  });

  it("escapes mermaid source in the fallback block", async () => {
    const html = await buildExportHtml("```mermaid\nA < B && C > D\n```\n", "d.md");
    expect(html).toContain("A &lt; B &amp;&amp; C &gt; D");
  });
});

describe("inlineImages", () => {
  const ctx = { vaultRoot: "/vault", docRel: "notes/deep/doc.md" };

  it("inlines a doc-relative image as a base64 data URI", async () => {
    const html = await inlineImages('<p><img src="img/pic.png" alt="x"></p>', ctx);
    expect(readFileBase64).toHaveBeenCalledWith("/vault/notes/deep/img/pic.png");
    expect(html).toContain('src="data:image/png;base64,QUJDRA=="');
  });

  it("resolves vault-root paths (leading slash)", async () => {
    await inlineImages('<img src="/assets/logo.svg">', ctx);
    expect(readFileBase64).toHaveBeenCalledWith("/vault/assets/logo.svg");
  });

  it("collapses ../ segments", async () => {
    await inlineImages('<img src="../../shared/a.jpg">', ctx);
    // docDir = notes/deep; ../../ climbs back to the vault root
    expect(readFileBase64).toHaveBeenCalledWith("/vault/shared/a.jpg");
  });

  it("leaves remote and data URLs untouched", async () => {
    const html = await inlineImages(
      '<img src="https://x.com/a.png"><img src="data:image/png;base64,AA==">',
      ctx,
    );
    expect(html).not.toContain("data:image/png;base64,QUJDRA==");
    expect(readFileBase64).not.toHaveBeenCalled();
  });

  it("keeps the original src when the file cannot be read", async () => {
    (readFileBase64 as any).mockRejectedValueOnce(new Error("no"));
    const html = await inlineImages('<img src="gone.png">', ctx);
    expect(html).toContain('src="gone.png"');
  });

  it("buildExportHtml inlines images when ctx is provided", async () => {
    const html = await buildExportHtml("![pic](img/pic.png)", "d.md", ctx);
    expect(readFileBase64).toHaveBeenCalledWith("/vault/notes/deep/img/pic.png");
    expect(html).toContain('src="data:image/png;base64,QUJDRA=="');
  });
});

describe("printHtml", () => {
  it("creates a full-screen iframe with the document and prints it", () => {
    const create = vi.spyOn(document, "createElement").mockReturnValue({
      style: {},
      parentNode: {},
      contentWindow: {
        addEventListener: vi.fn(),
        focus: vi.fn(),
        print: vi.fn(),
      },
      srcdoc: "",
    } as any);
    const append = vi.spyOn(document.body, "appendChild").mockImplementation(() => ({} as any));
    const remove = vi.spyOn(document.body, "removeChild").mockImplementation(() => ({} as any));
    vi.spyOn(window, "setTimeout").mockImplementation(((fn: any) => {
      fn();
      return 0;
    }) as any);

    printHtml("<h1>hi</h1>");

    expect(create).toHaveBeenCalledWith("iframe");
    expect(append).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    create.mockRestore();
    append.mockRestore();
    remove.mockRestore();
    vi.restoreAllMocks();
  });
});
