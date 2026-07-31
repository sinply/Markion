import { useDocStore } from "../stores/docStore";

export function Tabs() {
  const openDocs = useDocStore((s) => s.openDocs);
  const activeDocId = useDocStore((s) => s.activeDocId);
  const dirtyMap = useDocStore((s) => s.dirtyMap);
  const switchTo = useDocStore((s) => s.switchTo);
  const closeDoc = useDocStore((s) => s.closeDoc);

  if (openDocs.length === 0) return null;

  return (
    <div style={{ display: "flex", borderBottom: "1px solid #ddd", overflow: "auto", flexShrink: 0 }}>
      {openDocs.map((doc) => (
        <div
          key={doc.id}
          onClick={() => switchTo(doc.id)}
          style={{
            padding: "6px 10px",
            cursor: "pointer",
            borderBottom: doc.id === activeDocId ? "2px solid #0366d6" : "2px solid transparent",
            fontWeight: doc.id === activeDocId ? 600 : 400,
            whiteSpace: "nowrap",
            fontSize: 13,
            userSelect: "none",
          }}
        >
          {dirtyMap[doc.id] && <span style={{ color: "#d73a49" }}>{"● "}</span>}
          {doc.title}
          <button
            onClick={(e) => { e.stopPropagation(); closeDoc(doc.id); }}
            style={{ marginLeft: 6, border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#666" }}
          >
            {"×"}
          </button>
        </div>
      ))}
    </div>
  );
}
