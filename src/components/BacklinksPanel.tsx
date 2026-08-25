import { useEffect, useState } from "react";
import { useVaultStore } from "../stores/vaultStore";
import { useDocStore } from "../stores/docStore";
import { findBacklinks, type Backlink } from "../lib/ipc";
import { openNote } from "../lib/openNote";

export function BacklinksPanel() {
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const activeDocId = useDocStore((s) => s.activeDocId);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!vaultRoot || !activeDocId) {
        setBacklinks([]);
        return;
      }
      setLoading(true);
      try {
        const links = await findBacklinks(vaultRoot, activeDocId);
        if (!cancelled) setBacklinks(links);
      } catch {
        if (!cancelled) setBacklinks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [vaultRoot, activeDocId]);

  const openLink = (path: string) => {
    if (!vaultRoot) return;
    void openNote(vaultRoot, path);
  };

  return (
    <div style={{ padding: 8, overflow: "hidden", fontSize: 13 }}>
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 12, color: "var(--fg-muted)" }}>BACKLINKS</div>
      {loading && <div style={{ color: "var(--fg-muted)" }}>Scanning…</div>}
      {!loading && backlinks.length === 0 && (
        <div style={{ color: "var(--fg-muted)" }}>No backlinks</div>
      )}
      {backlinks.map((b) => (
        <div
          key={b.path}
          onClick={() => openLink(b.path)}
          style={{ padding: "2px 0", cursor: "pointer", color: "var(--accent)" }}
        >
          {b.title}
        </div>
      ))}
    </div>
  );
}
