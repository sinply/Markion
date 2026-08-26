import { describe, it, expect, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { ImageWidget, openLightbox } from "../widgets";

/** Lightbox overlay keyboard accessibility: the overlay container is focused
 *  (tabindex="-1") when opened so its Escape handler can fire; click-to-close
 *  keeps working. */

function mockView(): EditorView {
  return { state: EditorState.create({}) } as unknown as EditorView;
}

function overlay(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(".cm-lightbox");
}

afterEach(() => {
  overlay()?.remove();
});

describe("lightbox close behavior", () => {
  it("opens on image click with the overlay focused", () => {
    const w = new ImageWidget("pic.png", "alt");
    const wrap = w.toDOM(mockView());
    document.body.appendChild(wrap);
    const img = wrap.querySelector("img") as HTMLImageElement;
    img.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const ov = overlay();
    expect(ov).not.toBeNull();
    // The overlay DIV itself (not the img) must be focusable and focused,
    // otherwise the keydown listener can never receive Escape.
    expect(document.activeElement).toBe(ov);
    wrap.remove();
  });

  it("Escape on the focused overlay removes it", () => {
    openLightbox("https://example.com/a.png");
    const ov = overlay();
    expect(ov).not.toBeNull();
    ov!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(overlay()).toBeNull();
  });

  it("Escape closes the lightbox even when focus moved elsewhere (document-level)", () => {
    openLightbox("b.png");
    expect(overlay()).not.toBeNull();
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(overlay()).toBeNull();
  });

  it("click anywhere still closes the lightbox", () => {
    openLightbox("c.png");
    const ov = overlay();
    expect(ov).not.toBeNull();
    ov!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(overlay()).toBeNull();
  });

  it("a non-Escape keydown does not close the lightbox", () => {
    openLightbox("d.png");
    const ov = overlay();
    ov!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(overlay()).not.toBeNull();
    ov!.remove();
  });
});
