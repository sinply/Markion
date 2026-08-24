import { useCallback, useEffect, useState } from "react";
import { useUiStore } from "../stores/uiStore";
import { useVaultStore } from "../stores/vaultStore";
import { useI18n } from "../lib/i18n";
import { listTrash, restoreTrash, type TrashEntry } from "../lib/ipc";
import { docTitle } from "../lib/docTitle";

/** Vault-internal trash viewer: lists deleted files and restores them to
 *  their original location (delete goes to `.markion/trash`, see FileTree). */
export function TrashDialog() {
  const open = useUiStore((s) => s.trashOpen);
  const setOpen = useUiStore((s) => s.setTrashOpen);
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const loadTree = useVaultStore((s) => s.loadTree);
  const t = useI18n();
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    if (!vaultRoot) return;
    try {
      setEntries(await listTrash(vaultRoot));
      setErr("");
    } catch {
      setErr(t.trashReadFailed);
    }
  }, [vaultRoot, t]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  if (!open) return null;

  const restore = async (rel: string) => {
    if (!vaultRoot) return;
    try {
      await restoreTrash(vaultRoot, rel);
      await refresh();
      await loadTree(vaultRoot);
    } catch (e) {
      setErr(String(e));
    }
  };

  const fmt = (secs: number) => {
    if (!secs) return "";
    const d = new Date(secs * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
          width: 520,
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
          {t.trashTitle}
        </div>
        <div style={{ padding: "8px 16px", overflow: "auto", display: "flex", flexDirection: "column" }}>
          {err && <div style={{ color: "#d73a49", fontSize: 13, padding: "6px 0" }}>{err}</div>}
          {entries.length === 0 && !err && (
            <div style={{ color: "var(--fg-muted)", fontSize: 13, padding: "8px 0" }}>{t.trashEmpty}</div>
          )}
          {entries.map((entry) => (
            <div
              key={entry.path}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 0",
                borderBottom: "1px solid var(--border)",
                fontSize: 13,
              }}
            >
              <span style={{ opacity: 0.7 }}>{entry.kind === "folder" ? "📁" : "📄"}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={entry.path}>
                {entry.kind === "folder" ? entry.name : docTitle(entry.name)}
              </span>
              <span style={{ color: "var(--fg-muted)", fontSize: 12 }}>{fmt(entry.modified)}</span>
              <button
                style={{
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: 4,
                  color: "#fff",
                  padding: "4px 10px",
                  cursor: "pointer",
                  fontSize: 12,
                }}
                onClick={() => void restore(entry.path)}
              >
                {t.trashRestore}
              </button>
            </div>
          ))}
        </div>
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
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
        </div>
      </div>
    </div>
  );
}
