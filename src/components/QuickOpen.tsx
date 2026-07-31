import { useState, useMemo, useEffect } from "react";
import { useVaultStore } from "../stores/vaultStore";
import { useDocStore } from "../stores/docStore";
import { readFile } from "../lib/ipc";

function flattenFiles(
  node: { name: string; path: string; kind: "file" | "folder"; children: any[] } | null,
): { name: string; path: string }[] {
  if (!node) return [];
  const files: { name: string; path: string }[] = [];
  function walk(n: { name: string; path: string; kind: "file" | "folder"; children: any[] }) {
    if (n.kind === "file") files.push({ name: n.name, path: n.path });
    else n.children.forEach(walk);
  }
  walk(node);
  return files;
}

export function QuickOpen() {
  const tree = useVaultStore((s) => s.tree);
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const openDoc = useDocStore((s) => s.openDoc);
  const setContent = useDocStore((s) => s.setActiveContent);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "p") {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const files = useMemo(() => flattenFiles(tree), [tree]);
  const filtered = files.filter((f) =>
    f.name.toLowerCase().includes(query.toLowerCase()),
  );

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", top: "15%", left: "30%", width: "40%", maxHeight: "60%",
        background: "#fff", boxShadow: "0 4px 24px rgba(0,0,0,0.25)", borderRadius: 8,
        zIndex: 1000, overflow: "hidden", display: "flex", flexDirection: "column",
      }}
    >
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search files by name…"
        style={{
          width: "100%", boxSizing: "border-box", padding: "10px 14px",
          fontSize: 15, border: "none", outline: "none", borderBottom: "1px solid #eee",
        }}
      />
      <div style={{ overflow: "auto", flex: 1 }}>
        {filtered.map((f) => (
          <div
            key={f.path}
            onClick={async () => {
              if (!vaultRoot) return;
              const content = await readFile(vaultRoot, f.path);
              openDoc(f.name, f.path);
              setContent(content);
              setOpen(false);
            }}
            style={{
              padding: "6px 14px", cursor: "pointer", borderBottom: "1px solid #f5f5f5", fontSize: 14,
            }}
          >
            {f.name}
          </div>
        ))}
      </div>
    </div>
  );
}
