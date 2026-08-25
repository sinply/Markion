import { renderMarkdown } from "../editor/markdown";
import { useDocStore } from "../stores/docStore";
import { useVaultStore } from "../stores/vaultStore";
import { getEditorView } from "../editor/registry";
import { exportFile, readFileBase64, writeFileBase64 } from "./ipc";
import { save } from "@tauri-apps/plugin-dialog";
// Inline the KaTeX stylesheet so the exported HTML renders formulas without
// any external dependency (local-first: no CDN).
import katexCss from "katex/dist/katex.min.css?raw";

// Lazy-load heavy renderers only when the corresponding export runs.
function lazyHtml2canvas(): Promise<typeof import("html2canvas").default> {
  return import("html2canvas").then((m) => m.default);
}
function lazyJsPdf(): Promise<typeof import("jspdf").jsPDF> {
  return import("jspdf").then((m) => m.jsPDF);
}

/** Private-use placeholder wrapping a math run, so markdown-it can't mangle
 *  `$...$` content (e.g. `$a*b$` becoming italics) before KaTeX sees it. */
const P = "\uE000";

/** Extract `$$...$$` and `$...$` runs into a side array and replace them with
 *  placeholders. Block math first so inline regexes can't touch it. */
function extractMath(src: string): { src: string; runs: { tex: string; display: boolean }[] } {
  const runs: { tex: string; display: boolean }[] = [];
  let out = src.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => {
    const i = runs.length;
    runs.push({ tex: tex.trim(), display: true });
    return `${P}B${i}${P}`;
  });
  out = out.replace(/(?<![\$\\])\$([^\$\n]+?)\$(?!\$)/g, (_m, tex: string) => {
    const i = runs.length;
    runs.push({ tex: tex.trim(), display: false });
    return `${P}I${i}${P}`;
  });
  return { src: out, runs };
}

/** Replace math placeholders with KaTeX-rendered HTML. */
async function restoreMath(
  html: string,
  runs: { tex: string; display: boolean }[],
): Promise<string> {
  // Lazy-load katex only when math is actually present in the export.
  const katex = (await import("katex")).default;
  return html.replace(new RegExp(`${P}[BI](\\d+)${P}`, "g"), (_m, n: string) => {
    const run = runs[Number(n)];
    if (!run) return "";
    try {
      return katex.renderToString(run.tex, {
        displayMode: run.display,
        throwOnError: false,
      });
    } catch {
      return run.display ? `$$\n${run.tex}\n$$` : `$${run.tex}$`;
    }
  });
}

/** Turn mermaid placeholder divs (from markdown.ts) back into plain code
 *  blocks for the export — the exported file has no live renderer. */
function restoreMermaid(html: string): string {
  return html.replace(
    /<div class="cm-mermaid-pending"[^>]*data-lang="[^"]*"[^>]*>([\s\S]*?)<\/div>/g,
    (_m, code: string) => `<pre><code class="language-mermaid">${code}</code></pre>`,
  );
}

const EXPORT_CSS = `
body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; line-height: 1.6; color: #1f2328; max-width: 820px; margin: 0 auto; padding: 24px; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 0.6em; }
h1 { font-size: 1.8em; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.3em; }
code { background: #f3f4f6; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; font-family: Consolas, "Courier New", monospace; }
pre { background: #f6f8fa; padding: 12px; border-radius: 6px; overflow-x: auto; }
pre code { background: none; padding: 0; }
blockquote { border-left: 4px solid #d0d7de; margin: 0; padding: 0 1em; color: #57606a; }
table { border-collapse: collapse; margin: 1em 0; }
th, td { border: 1px solid #d0d7de; padding: 6px 12px; }
th { background: #f6f8fa; }
img { max-width: 100%; }
hr { border: none; border-top: 1px solid #d0d7de; margin: 1.5em 0; }
input[type="checkbox"] { margin-right: 0.4em; }
`;

/** Render markdown to a self-contained HTML document (KaTeX + highlight.js
 *  styles inlined; mermaid fences fall back to source code blocks). When
 *  `ctx` is given, local `<img>` sources are inlined as base64 so the file
 *  renders standalone anywhere. */
export async function buildExportHtml(
  markdown: string,
  title: string,
  ctx?: { vaultRoot: string; docRel: string },
): Promise<string> {
  const { src, runs } = extractMath(markdown);
  const body = renderMarkdown(src);
  let withMath = await restoreMath(body, runs);
  const withMermaid = restoreMermaid(withMath);
  let withImages = withMermaid;
  if (ctx) withImages = await inlineImages(withImages, ctx);
  const safeTitle = title.replace(/[<>&"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : "&quot;",
  );
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>${katexCss}\n${EXPORT_CSS}</style>
</head>
<body>
<article>
${withImages}
</article>
</body>
</html>
`;
}

/** Resolve a relative image source against the exporting doc, then inline it
 *  as a base64 data URI. Remote/data URLs pass through untouched. */
export async function inlineImages(
  html: string,
  ctx: { vaultRoot: string; docRel: string },
): Promise<string> {
  const docDir = ctx.docRel.includes("/") ? ctx.docRel.slice(0, ctx.docRel.lastIndexOf("/")) : "";
  const toAbsolute = (src: string): string | null => {
    if (/^(https?:|data:)/i.test(src) || !src) return null;
    let decoded: string;
    try {
      decoded = decodeURIComponent(src);
    } catch {
      decoded = src; // literal `%` in a filename is not an escape sequence
    }
    if (/^[a-zA-Z]:[\\/]/.test(decoded)) return decoded; // Windows drive path
    const normalized = decoded.replace(/\\/g, "/").replace(/^\/+/, "");
    if (decoded.startsWith("/")) return `${ctx.vaultRoot}/${normalized}`; // vault-root path
    const joined = docDir ? `${docDir}/${normalized}` : normalized;
    // Collapse ./ and ../ segments.
    const parts: string[] = [];
    for (const seg of joined.split("/")) {
      if (seg === "." || seg === "") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    return `${ctx.vaultRoot}/${parts.join("/")}`;
  };
  const mimeOf = (src: string): string => {
    const ext = src.split(".").pop()?.toLowerCase() ?? "";
    return (
      {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
        webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml",
      }[ext] ?? "application/octet-stream"
    );
  };

  let out = html;
  const imgs = [...out.matchAll(/<img src="([^"]+)"[^>]*>/g)];
  for (const m of imgs) {
    const abs = toAbsolute(m[1]);
    if (!abs) continue;
    try {
      const b64 = await readFileBase64(abs);
      const dataUri = `data:${mimeOf(m[1])};base64,${b64}`;
      out = out.replace(m[0], m[0].replace(m[1], dataUri));
    } catch {
      // Unreadable image — leave the original reference in place.
    }
  }
  return out;
}

/** Print `html` via a full-screen iframe so the OS print dialog (with
 *  "Save as PDF") shows exactly the exported document. The frame is removed
 *  once printing finishes. Exported for tests; keeps the flow testable. */
export function printHtml(html: string): void {
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.inset = "0";
  frame.style.width = "100%";
  frame.style.height = "100%";
  frame.style.border = "0";
  frame.style.zIndex = "9999";
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  const cleanup = () => {
    document.body.removeChild(frame);
  };
  if (!win) {
    cleanup();
    return;
  }
  win.addEventListener("afterprint", cleanup, { once: true });
  // srcdoc needs the full document (base64 images, inline styles).
  frame.srcdoc = html;
  // Chrome-family engines print iframe content via contentWindow.print().
  win.addEventListener("load", () => {
    win.focus();
    win.print();
  }, { once: true });
  // Safety net: if the print dialog never fires afterprint (cancelled on some
  // engines), drop the frame once the dialog has had time to show.
  window.setTimeout(() => {
    if (frame.parentNode) cleanup();
  }, 30000);
}

/** Live editor text for the active doc (falls back to the store snapshot
 *  when the editor isn't mounted). Exports and manual saves must use the
 *  current buffer — the store's activeContent is only refreshed on open. */
export function activeEditorText(): string {
  const store = useDocStore.getState();
  const view = getEditorView();
  if (view) return view.state.doc.toString();
  return store.activeContent;
}

/** Export the active note: HTML (fully rendered) or raw Markdown. Uses the
 *  save dialog to pick the destination, then writes via the backend. */
export async function exportActiveNote(asHtml: boolean): Promise<void> {
  const docStore = useDocStore.getState();
  const vaultRoot = useVaultStore.getState().vaultRoot;
  const active = docStore.openDocs.find((d) => d.id === docStore.activeDocId);
  if (!vaultRoot || !active) return;
  const content = activeEditorText();
  const base = active.title.replace(/\.md$/i, "");
  const picked = await save({
    defaultPath: `${base}.${asHtml ? "html" : "md"}`,
    filters: asHtml
      ? [{ name: "HTML", extensions: ["html"] }]
      : [{ name: "Markdown", extensions: ["md"] }],
  });
  if (typeof picked !== "string") return;
  const output = asHtml
    ? await buildExportHtml(content, active.title, { vaultRoot, docRel: active.path })
    : content;
  await exportFile(picked, output);
}

/** Open the OS print dialog for the active note (PDF via "Save as PDF").
 *  Local images are inlined so the printout matches the note. */
export async function exportActivePdf(): Promise<void> {
  const docStore = useDocStore.getState();
  const vaultRoot = useVaultStore.getState().vaultRoot;
  const active = docStore.openDocs.find((d) => d.id === docStore.activeDocId);
  if (!vaultRoot || !active) return;
  const html = await buildExportHtml(activeEditorText(), active.title, {
    vaultRoot,
    docRel: active.path,
  });
  printHtml(html);
}

/** Render an HTML document to a canvas (offscreen, at the exported width). */
export async function htmlToCanvas(html: string, width = 820): Promise<HTMLCanvasElement> {
  const holder = document.createElement("div");
  holder.style.position = "fixed";
  holder.style.left = "-10000px";
  holder.style.top = "0";
  holder.style.width = `${width}px`;
  holder.style.background = "#ffffff";
  holder.style.zIndex = "-1";
  holder.innerHTML = html;
  document.body.appendChild(holder);
  try {
    const html2canvas = await lazyHtml2canvas();
    const canvas = await html2canvas(holder, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
    });
    return canvas;
  } finally {
    document.body.removeChild(holder);
  }
}

function base64FromCanvas(canvas: HTMLCanvasElement, mime: string, quality?: number): string {
  return canvas.toDataURL(mime, quality).split(",")[1] ?? "";
}

/** Export the active note as a real PDF file (renders the note to an image
 *  canvas and paginates it into a jsPDF document, saved via the dialog). */
export async function exportActivePdfFile(): Promise<void> {
  const docStore = useDocStore.getState();
  const vaultRoot = useVaultStore.getState().vaultRoot;
  const active = docStore.openDocs.find((d) => d.id === docStore.activeDocId);
  if (!vaultRoot || !active) return;
  const base = active.title.replace(/\.md$/i, "");
  const picked = await save({
    defaultPath: `${base}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (typeof picked !== "string") return;
  const html = await buildExportHtml(activeEditorText(), active.title, {
    vaultRoot,
    docRel: active.path,
  });
  const canvas = await htmlToCanvas(html);
  const jsPDF = await lazyJsPdf();
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgHeight = (canvas.height * pageWidth) / canvas.width;
  let remaining = imgHeight;
  let offset = 0;
  pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, offset, pageWidth, imgHeight);
  remaining -= pageHeight;
  while (remaining > 0) {
    offset -= pageHeight;
    pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, offset, pageWidth, imgHeight);
    remaining -= pageHeight;
  }
  const bytes = pdf.output("arraybuffer");
  await writeFileBase64(picked, base64FromArrayBuffer(bytes));
}

/** Export the active note as a PNG image of its rendered content. */
export async function exportActiveImage(): Promise<void> {
  const docStore = useDocStore.getState();
  const vaultRoot = useVaultStore.getState().vaultRoot;
  const active = docStore.openDocs.find((d) => d.id === docStore.activeDocId);
  if (!vaultRoot || !active) return;
  const base = active.title.replace(/\.md$/i, "");
  const picked = await save({
    defaultPath: `${base}.png`,
    filters: [{ name: "PNG", extensions: ["png"] }],
  });
  if (typeof picked !== "string") return;
  const html = await buildExportHtml(activeEditorText(), active.title, {
    vaultRoot,
    docRel: active.path,
  });
  const canvas = await htmlToCanvas(html);
  await writeFileBase64(picked, base64FromCanvas(canvas, "image/png"));
}

/** ArrayBuffer -> base64 (jsPDF output). */
export function base64FromArrayBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
