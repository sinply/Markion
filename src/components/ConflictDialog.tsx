import { useUiStore } from "../stores/uiStore";
import { useDocStore } from "../stores/docStore";
import { getEditorView } from "../editor/registry";
import { useI18n } from "../lib/i18n";

/** Two-way choice when a dirty document changes on disk: keep the in-memory
 *  edits or replace them with the disk version. */
export function ConflictDialog() {
  const conflict = useUiStore((s) => s.conflict);
  const setConflict = useUiStore((s) => s.setConflict);
  const t = useI18n();

  if (!conflict) return null;

  const keepMine = () => setConflict(null);

  const loadDisk = () => {
    const view = getEditorView();
    if (view) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: conflict.diskContent },
      });
    }
    const doc = useDocStore.getState().openDocs.find((d) => d.path === conflict.path);
    if (doc) {
      useDocStore.getState().markClean(doc.id);
      useDocStore.getState().markSaved(doc.id, conflict.diskContent);
      useDocStore.getState().setActiveContent(conflict.diskContent);
    }
    setConflict(null);
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1001, background: "rgba(0,0,0,0.35)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        style={{
          width: 420, maxWidth: "90%", background: "var(--bg)", borderRadius: 8,
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)", padding: 20,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 15 }}>{t.conflictTitle}</div>
        <div style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 16 }}>
          {t.conflictBody(conflict.path)}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={keepMine}
            style={{ padding: "6px 14px", cursor: "pointer", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)", borderRadius: 5 }}
          >
            {t.conflictKeep}
          </button>
          <button
            onClick={loadDisk}
            style={{ padding: "6px 14px", cursor: "pointer", border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--accent-fg)", borderRadius: 5 }}
          >
            {t.conflictLoad}
          </button>
        </div>
      </div>
    </div>
  );
}
