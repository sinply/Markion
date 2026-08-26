import { useUiStore } from "../stores/uiStore";
import { useDocStore } from "../stores/docStore";
import { useVaultStore } from "../stores/vaultStore";
import { getEditorView } from "../editor/registry";
import { writeFileAtomic } from "../lib/ipc";
import { markAppChange } from "../hooks/useExternalChanges";
import { useI18n } from "../lib/i18n";

/** Two-way choice when a dirty document changes on disk: keep the in-memory
 *  edits or replace them with the disk version. */
export function ConflictDialog() {
  const conflict = useUiStore((s) => s.conflict);
  const setConflict = useUiStore((s) => s.setConflict);
  const t = useI18n();

  if (!conflict) return null;

  const keepMine = async () => {
    const store = useDocStore.getState();
    const doc = store.openDocs.find((d) => d.path === conflict.path);
    // Only read the live buffer when it really shows THIS doc; otherwise fall
    // back to the doc's draft (single-writer: never guess unmounted content).
    const view =
      getEditorView() && doc && store.activeDocId === doc.id ? getEditorView() : null;
    const text = view
      ? view.state.doc.toString()
      : doc && store.drafts[doc.id] !== undefined
        ? store.drafts[doc.id]
        : null;
    // Persist OUR version right away so the watcher stops flagging this file
    // and the next autosave/close has nothing left to reconcile. Just closing
    // the dialog used to leave disk and memory diverged until some later save.
    if (text !== null && doc) {
      const vaultRoot = useVaultStore.getState().vaultRoot;
      if (vaultRoot) {
        try {
          await writeFileAtomic(vaultRoot, conflict.path, text);
          markSavedAndClean(doc.id, text);
          markAppChange(conflict.path);
        } catch (e) {
          useUiStore.getState().showToast(`${t.saveFailed}: ${String(e)}`);
        }
      }
    }
    setConflict(null);
  };

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

/** Record `text` as the saved state: dirty flag cleared and the draft/snapshot
 *  aligned so no later flush re-writes the same bytes. */
function markSavedAndClean(id: string, text: string): void {
  const store = useDocStore.getState();
  store.markSaved(id, text);
  store.markClean(id);
}
