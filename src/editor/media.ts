import { Facet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { convertFileSrc } from "@tauri-apps/api/core";
import { saveImage } from "../lib/ipc";
import { useSettingsStore } from "../stores/settingsStore";

export interface MarkdownContext {
  vaultRoot: string;
  docRel: string;
}

/** Carries the vault root + current doc relative path into CM6 widgets. */
export const markdownContextFacet = Facet.define<MarkdownContext>();

export function isRemoteSrc(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

export function isAbsolutePath(src: string): boolean {
  return /^([a-zA-Z]:[\\/]|\/)/.test(src);
}

/** Decode URL percent-escapes (%20 -> space, %23 -> #) in a local path. */
function decodePath(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    return src;
  }
}

/** Resolve `..`/`.` segments in a posix-style path without Node's path module. */
function normalizeRel(rel: string): string {
  const out: string[] = [];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/** Absolute, forward-slash path to a local image (null for remote/data/blob). */
export function resolveImagePath(src: string, ctx: MarkdownContext): string | null {
  if (isRemoteSrc(src) || /^(data:|blob:)/.test(src)) return null;
  if (isAbsolutePath(src)) return decodePath(src.replace(/\\/g, "/"));
  const docDir = ctx.docRel.includes("/")
    ? ctx.docRel.slice(0, ctx.docRel.lastIndexOf("/"))
    : "";
  const combined = normalizeRel(decodePath(docDir ? `${docDir}/${src}` : src));
  const root = ctx.vaultRoot.replace(/\\/g, "/").replace(/\/$/, "");
  return `${root}/${combined}`;
}

/** Convert a raw markdown image src to a displayable URL. */
export function imageToSrc(src: string, ctx?: MarkdownContext): string {
  if (!ctx || isRemoteSrc(src) || /^(data:|blob:)/.test(src)) return src;
  const abs = resolveImagePath(src, ctx) ?? src;
  try {
    return convertFileSrc(abs);
  } catch {
    return abs;
  }
}

const IMAGE_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/svg+xml": "svg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
};

export function extFromType(type: string, fallbackName?: string): string {
  if (IMAGE_MIME[type]) return IMAGE_MIME[type];
  const subtype = type.split("/")[1];
  if (subtype && /^[a-z0-9]+$/i.test(subtype)) return subtype;
  const nameExt = fallbackName?.match(/\.([a-z0-9]+)$/i)?.[1];
  return nameExt ? nameExt.toLowerCase() : "png";
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export function imageAltFromName(name: string): string {
  const base = name.replace(/\.([a-z0-9]+)$/i, "");
  const safe = base.replace(/[\[\]()\\/:*?"<>|#\n]/g, "-").trim();
  return safe || "image";
}

export function todayStamp(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}${m}${day}`;
}

async function insertImages(
  view: EditorView,
  files: File[],
  from: number,
  to: number,
): Promise<void> {
  const ctx = view.state.facet(markdownContextFacet)[0];
  if (!ctx) return;

  const { assetsStrategy, pathStyle } = useSettingsStore.getState();

  let pos = Math.min(from, view.state.doc.length);
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ext = extFromType(file.type, file.name);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      continue;
    }
    let rel: string;
    try {
      rel = await saveImage(
        ctx.vaultRoot, bytes, ext, ctx.docRel,
        assetsStrategy, pathStyle, todayStamp(),
      );
    } catch {
      continue;
    }
    rel = rel.replace(/\\/g, "/");
    const text = `![${imageAltFromName(file.name)}](${rel})`;
    const insertTo = i === 0 ? Math.min(to, view.state.doc.length) : pos;
    try {
      view.dispatch({
        changes: { from: pos, to: insertTo, insert: text },
        selection: { anchor: pos + text.length },
      });
    } catch {
      return; // view destroyed mid-paste
    }
    pos += text.length;
  }
  try {
    view.focus();
  } catch {
    // view destroyed; nothing to focus
  }
}

/** A single-line plain URL from clipboard text (normalized with https://),
 *  or null when the text is not a bare URL. */
export function urlFromClipboard(text: string): string | null {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null; // multi-line / spaced text is not a URL
  if (/^https?:\/\//i.test(t)) return t;
  if (/^www\./i.test(t)) return `https://${t}`;
  return null;
}

/** Markdown link text for a pasted URL: the current selection when it is a
 *  single-line non-blank range, else the URL itself. */
export function urlToMarkdown(
  text: string,
  selected: string,
): { markdown: string; url: string } | null {
  const url = urlFromClipboard(text);
  if (!url) return null;
  const trimmed = selected.trim();
  const linkText = trimmed && !/[\r\n]/.test(trimmed) ? trimmed : url;
  return { markdown: `[${linkText}](${url})`, url };
}

/** Always-on paste/drop handling for images (independent of live-preview toggle). */
export const imagePasteDropExtension = EditorView.domEventHandlers({
  paste(event, view) {
    const items = Array.from(event.clipboardData?.items ?? []);
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file && isImageFile(file)) files.push(file);
      }
    }
    if (files.length > 0) {
      event.preventDefault();
      const sel = view.state.selection.main;
      void insertImages(view, files, sel.from, sel.to);
      return true;
    }
    // Plain-text URL: auto-convert to a markdown link (pastes like Obsidian).
    const text = event.clipboardData?.getData("text/plain") ?? "";
    const sel = view.state.selection.main;
    const selected = view.state.sliceDoc(sel.from, sel.to);
    const link = urlToMarkdown(text, selected);
    if (!link) return false;
    event.preventDefault();
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: link.markdown },
      selection: { anchor: sel.from + link.markdown.length },
    });
    return true;
  },

  drop(event, view) {
    const files = Array.from(event.dataTransfer?.files ?? []);
    const images = files.filter(isImageFile);
    if (images.length > 0) {
      event.preventDefault();
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        ?? view.state.selection.main.head;
      void insertImages(view, images, pos, pos);
      return true;
    }
    // Non-image files: insert links (Obsidian-style). `.md` becomes a
    // `[[wikilink]]`; anything else a `[name](name)` markdown link (relative
    // to the current doc, since the browser hides absolute paths).
    if (files.length === 0) return false;
    event.preventDefault();
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      ?? view.state.selection.main.head;
    const insert = files
      .map((f) =>
        /\.md$/i.test(f.name)
          ? `[[${f.name.replace(/\.md$/i, "")}]]`
          : `[${f.name}](${f.name})`,
      )
      .join(" ");
    view.dispatch({
      changes: { from: pos, to: pos, insert },
      selection: { anchor: pos + insert.length },
    });
    return true;
  },
});
