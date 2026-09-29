import { useState } from "react";
import { useDocStore } from "../stores/docStore";
import { useUiStore } from "../stores/uiStore";
import { flushDoc } from "../lib/docSave";

export function Tabs() {
  const openDocs = useDocStore((s) => s.openDocs);
  const activeDocId = useDocStore((s) => s.activeDocId);
  const dirtyMap = useDocStore((s) => s.dirtyMap);
  const switchTo = useDocStore((s) => s.switchTo);
  const closeDoc = useDocStore((s) => s.closeDoc);
  const reorderDocs = useDocStore((s) => s.reorderDocs);
  const addRecentlyClosed = useUiStore((s) => s.addRecentlyClosed);
  const [dragId, setDragId] = useState<string | null>(null);

  if (openDocs.length === 0) return null;

  // Flush pending edits BEFORE removing the doc: after closeDoc the autosave
  // timer finds no path and silently drops everything unsaved. A failed flush
  // (locked/read-only file, or an open conflict dialog) must NOT close the tab
  // — that would throw the draft away with no way back.
  const closeTab = async (id: string) => {
    const doc = openDocs.find((d) => d.id === id);
    if (!(await flushDoc(id))) {
      useUiStore
        .getState()
        .showToast(`Could not save "${doc?.title ?? id}" — the tab was kept open.`);
      return;
    }
    if (doc) addRecentlyClosed({ title: doc.title, path: doc.path });
    closeDoc(id);
  };

  return (
    <div style={{ display: "flex", borderBottom: "1px solid var(--border)", overflow: "auto", flexShrink: 0 }}>
      {openDocs.map((doc) => (
        <div
          key={doc.id}
          draggable
          onDragStart={() => setDragId(doc.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragId && dragId !== doc.id) reorderDocs(dragId, doc.id);
            setDragId(null);
          }}
          onClick={() => switchTo(doc.id)}
          style={{
            padding: "6px 10px",
            cursor: "pointer",
            borderBottom: doc.id === activeDocId ? "2px solid var(--accent)" : "2px solid transparent",
            fontWeight: doc.id === activeDocId ? 600 : 400,
            whiteSpace: "nowrap",
            fontSize: 13,
            userSelect: "none",
            opacity: dragId === doc.id ? 0.5 : 1,
          }}
        >
          {dirtyMap[doc.id] && <span style={{ color: "#d73a49" }}>{"● "}</span>}
          {doc.title}
          <button
            onClick={(e) => { e.stopPropagation(); void closeTab(doc.id); }}
            style={{ marginLeft: 6, border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "var(--fg-muted)" }}
          >
            {"×"}
          </button>
        </div>
      ))}
    </div>
  );
}
