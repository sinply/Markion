import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  id: string;
  label: string;
  danger?: boolean;
}

/** A small controlled context menu rendered at viewport coordinates.
 *  Closes on click outside, Escape, scroll, or window resize.
 *  Purely presentational: the parent owns position, items, and actions. */
export function ContextMenu({
  x,
  y,
  items,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Any pointerdown outside the menu closes it. `mousedown` (not click) so
    // the same right-click that opened a new menu cannot also pick an item.
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Scrolling or resizing under an open menu detaches it from its node -
    // close rather than leave a floating menu at stale coordinates.
    const onCloseEvt = () => onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onCloseEvt);
    window.addEventListener("wheel", onCloseEvt, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onCloseEvt);
      window.removeEventListener("wheel", onCloseEvt, true);
    };
  }, [onClose]);

  if (items.length === 0) return null;

  // Clamp so the menu never renders off-screen (estimate: 32px per item +
  // padding; menu width measured after mount via max-height/width styles).
  const estHeight = items.length * 30 + 8;
  const left = Math.min(x, Math.max(0, window.innerWidth - 190));
  const top = Math.min(y, Math.max(0, window.innerHeight - estHeight - 8));

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="context-menu"
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 1000,
        minWidth: 150,
        padding: "4px 0",
        background: "var(--bg, #fff)",
        border: "1px solid var(--border, #ddd)",
        borderRadius: 6,
        boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
        fontSize: 13,
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <div
          key={item.id}
          role="menuitem"
          data-menu-id={item.id}
          style={{
            padding: "5px 14px",
            cursor: "pointer",
            color: item.danger ? "#d73a49" : "inherit",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--bg-hover, rgba(0,0,0,0.06))";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
            onPick(item.id);
          }}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}
