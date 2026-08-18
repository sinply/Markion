import { useUiStore } from "../stores/uiStore";
import { useDocStore } from "../stores/docStore";
import { useI18n } from "../lib/i18n";
import { save } from "@tauri-apps/plugin-dialog";
import { exportFile } from "../lib/ipc";

/** A dirty document was deleted on disk. The user can either save the
 *  in-memory content somewhere else (Save As…) or discard it (close the tab). */
export function DeletedDialog() {
  const deleted = useUiStore((s) => s.deletedDoc);
  const setDeleted = useUiStore((s) => s.setDeletedDoc);
  const t = useI18n();

  if (!deleted) return null;

  const close = () => setDeleted(null);

  const discard = () => {
    useDocStore.getState().closeDoc(deleted.path);
    close();
  };

  const saveAs = async () => {
    const picked = await save({
      defaultPath: deleted.title,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (typeof picked !== "string") return; // cancelled — keep the dialog open
    try {
      await exportFile(picked, deleted.content);
      useDocStore.getState().closeDoc(deleted.path);
      close();
    } catch {
      // save failed — leave the dialog open so the user can retry or discard
    }
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
          width: 440, maxWidth: "90%", background: "var(--bg)", borderRadius: 8,
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)", padding: 20,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 15 }}>{t.deletedTitle}</div>
        <div style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 16 }}>
          {t.deletedBody(deleted.path)}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={discard}
            style={{ padding: "6px 14px", cursor: "pointer", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)", borderRadius: 5 }}
          >
            {t.deletedDiscard}
          </button>
          <button
            onClick={() => void saveAs()}
            style={{ padding: "6px 14px", cursor: "pointer", border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--accent-fg)", borderRadius: 5 }}
          >
            {t.deletedSaveAs}
          </button>
        </div>
      </div>
    </div>
  );
}
