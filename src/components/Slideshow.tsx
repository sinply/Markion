import { useCallback, useEffect, useState } from "react";
import { useUiStore } from "../stores/uiStore";
import { useDocStore } from "../stores/docStore";
import { useI18n } from "../lib/i18n";
import { splitSlides } from "../lib/slides";
import { renderMarkdown } from "../editor/markdown";
import { useVaultStore } from "../stores/vaultStore";
import { imageToSrc } from "../editor/media";

/** Fullscreen slideshow: split the active note into pages at headings,
 *  render each with the preview renderer, navigate with arrows / space,
 *  Escape to exit. */
export function Slideshow() {
  const open = useUiStore((s) => s.slideshowOpen);
  const setOpen = useUiStore((s) => s.setSlideshowOpen);
  const activeContent = useDocStore((s) => s.activeContent);
  const activeDocId = useDocStore((s) => s.activeDocId);
  const openDocs = useDocStore((s) => s.openDocs);
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const t = useI18n();
  const [page, setPage] = useState(0);

  const active = openDocs.find((d) => d.id === activeDocId);
  const slides = splitSlides(activeContent);
  const pageCount = slides.length;

  useEffect(() => {
    if (open) setPage(0);
  }, [open]);

  const next = useCallback(() => setPage((p) => Math.min(p + 1, pageCount - 1)), [pageCount]);
  const prev = useCallback(() => setPage((p) => Math.max(p - 1, 0)), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      } else if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        prev();
      } else if (e.key === "Home") {
        setPage(0);
      } else if (e.key === "End") {
        setPage(pageCount - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, next, prev, pageCount, setOpen]);

  if (!open) return null;

  const html = renderMarkdown(slides[page]?.content ?? "");
  const holder = document.createElement("div");
  holder.innerHTML = html;
  if (vaultRoot && active) {
    holder.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") ?? "";
      if (src) img.src = imageToSrc(src, { vaultRoot, docRel: active.path });
    });
  }
  const body = holder.innerHTML;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 4000,
        background: "#ffffff",
        color: "#1f2328",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          flex: 1,
          overflow: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 64px",
        }}
      >
        <div
          style={{ maxWidth: 900, width: "100%", fontSize: 22, lineHeight: 1.7 }}
          dangerouslySetInnerHTML={{ __html: body }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 20px",
          borderTop: "1px solid #e5e7eb",
          fontSize: 13,
          color: "#57606a",
          background: "#f6f8fa",
        }}
      >
        <span>
          {slides[page]?.title ?? ""} — {page + 1} / {pageCount}
        </span>
        <span>
          ← → {t.slidesHint} · Esc {t.slidesExit}
        </span>
      </div>
    </div>
  );
}