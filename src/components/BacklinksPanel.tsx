import { useEffect, useState } from "react";
import { useVaultStore } from "../stores/vaultStore";
import { useDocStore } from "../stores/docStore";
import { readFile, findBacklinks, type Backlink } from "../lib/ipc";

export function BacklinksPanel() {
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const activeDocId = useDocStore((s) => s.activeDocId);
  const openDoc = useDocStore((s) => s.openDoc);
  const setActiveContent = useDocStore((s) => s.setActiveContent);
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

  const openLink = async (path: string) => {
    if (!vaultRoot) return;
    try {
      const content = await readFile(vaultRoot, path);
      const title = path.split("/").pop() ?? path;
      openDoc(title, path);
      setActiveContent(content);
    } catch {
      // ignore read errors
    }
  };

  return (
    <div style={{ padding: 8, overflow: "auto", fontSize: 13 }}>
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 12, color: "#666" }}>BACKLINKS</div>
      {loading && <div style={{ color: "#999" }}>Scanning…</div>}
      {!loading && backlinks.length === 0 && (
        <div style={{ color: "#999" }}>No backlinks</div>
      )}
      {backlinks.map((b) => (
        <div
          key={b.path}
          onClick={() => openLink(b.path)}
          style={{ padding: "2px 0", cursor: "pointer", color: "#0366d6" }}
        >
          {b.title}
        </div>
      ))}
    </div>
  );
}
