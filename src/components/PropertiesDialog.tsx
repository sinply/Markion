import { useEffect, useState } from "react";
import { useUiStore } from "../stores/uiStore";
import { useDocStore } from "../stores/docStore";
import { useI18n } from "../lib/i18n";
import { getEditorView } from "../editor/registry";
import { extractFrontmatter, parseFrontmatter, replaceFrontmatter } from "../lib/frontmatter";

interface PropRow {
  key: string;
  value: string;
}

/** Properties editor for the active doc's YAML frontmatter. Reads the current
 *  frontmatter when opened, lets the user edit/add/remove key-value rows, and
 *  writes the result back through the CM6 editor (undoable + autosaved), not
 *  the filesystem directly. */
export function PropertiesDialog() {
  const open = useUiStore((s) => s.propertiesOpen);
  const setOpen = useUiStore((s) => s.setPropertiesOpen);
  const activeContent = useDocStore((s) => s.activeContent);
  const t = useI18n();
  const [rows, setRows] = useState<PropRow[]>([]);

  // Load the active doc's frontmatter whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    const fm = extractFrontmatter(activeContent);
    setRows(fm ? parseFrontmatter(fm.body).map(([key, value]) => ({ key, value })) : []);
  }, [open, activeContent]);

  if (!open) return null;

  const updateRow = (i: number, patch: Partial<PropRow>) => {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const removeRow = (i: number) => {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  };

  const save = () => {
    const view = getEditorView();
    if (!view) return;
    const props: [string, string][] = rows
      .filter((r) => r.key.trim() !== "")
      .map((r) => [r.key.trim(), r.value]);
    const current = view.state.doc.toString();
    const next = replaceFrontmatter(current, props);
    if (next !== current) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: next } });
    }
    setOpen(false);
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: "5px 8px",
    border: "1px solid var(--border)",
    borderRadius: 4,
    background: "var(--bg)",
    color: "var(--fg)",
    fontSize: 13,
    outline: "none",
    minWidth: 0,
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1001,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        style={{
          width: 460,
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--panel-bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "12px 16px", fontWeight: 600, fontSize: 14, borderBottom: "1px solid var(--border)" }}>
          {t.propertiesTitle}
        </div>
        <div style={{ padding: "12px 16px", overflow: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.length === 0 && (
            <div style={{ color: "var(--fg-muted)", fontSize: 13 }}>{t.propertiesEmpty}</div>
          )}
          {rows.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                style={{ ...inputStyle, flex: "0 0 130px" }}
                placeholder={t.propertiesKeyPlaceholder}
                value={row.key}
                onChange={(e) => updateRow(i, { key: e.target.value })}
              />
              <input
                style={inputStyle}
                placeholder={t.propertiesValuePlaceholder}
                value={row.value}
                onChange={(e) => updateRow(i, { value: e.target.value })}
              />
              <button
                style={{
                  flex: "0 0 auto",
                  border: "none",
                  background: "none",
                  color: "var(--fg-muted)",
                  cursor: "pointer",
                  fontSize: 15,
                  lineHeight: 1,
                  padding: 4,
                }}
                title="✕"
                onClick={() => removeRow(i)}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            style={{
              alignSelf: "flex-start",
              background: "none",
              border: "1px dashed var(--border)",
              borderRadius: 4,
              color: "var(--fg)",
              padding: "5px 10px",
              cursor: "pointer",
              fontSize: 13,
            }}
            onClick={() => setRows((rs) => [...rs, { key: "", value: "" }])}
          >
            {t.propertiesAdd}
          </button>
        </div>
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            style={{
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--fg)",
              padding: "6px 14px",
              cursor: "pointer",
              fontSize: 13,
            }}
            onClick={() => setOpen(false)}
          >
            {t.cancel}
          </button>
          <button
            style={{
              background: "var(--accent)",
              border: "none",
              borderRadius: 4,
              color: "#fff",
              padding: "6px 14px",
              cursor: "pointer",
              fontSize: 13,
            }}
            onClick={save}
          >
            {t.propertiesSave}
          </button>
        </div>
      </div>
    </div>
  );
}
