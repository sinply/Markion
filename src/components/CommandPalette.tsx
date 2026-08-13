import { useState, useMemo, useEffect } from "react";
import { useVaultStore } from "../stores/vaultStore";
import { useDocStore } from "../stores/docStore";
import { useSettingsStore } from "../stores/settingsStore";
import { readFile } from "../lib/ipc";
import { buildCommands, createAndOpenNote, type Command } from "../lib/commands";
import { useI18n } from "../lib/i18n";

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

export type PaletteItem =
  | { kind: "file"; name: string; path: string }
  | { kind: "command"; cmd: Command }
  | { kind: "create"; name: string };

/** Combine file + command results for a query; a "create note" entry appears
 *  only when nothing else matches a non-empty query. Exported for tests. */
export function filterPalette(
  files: { name: string; path: string }[],
  commands: Command[],
  query: string,
): PaletteItem[] {
  const q = query.trim().toLowerCase();
  const fileItems: PaletteItem[] = files
    .filter((f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
    .map((f) => ({ kind: "file" as const, name: f.name, path: f.path }));
  const cmdItems: PaletteItem[] = commands
    .filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.keywords ?? []).some((k) => k.toLowerCase().includes(q)),
    )
    .map((c) => ({ kind: "command" as const, cmd: c }));
  if (q && fileItems.length === 0 && cmdItems.length === 0) {
    return [{ kind: "create" as const, name: query.trim() }];
  }
  return [...fileItems, ...cmdItems];
}

export function CommandPalette() {
  const tree = useVaultStore((s) => s.tree);
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const openDoc = useDocStore((s) => s.openDoc);
  const setContent = useDocStore((s) => s.setActiveContent);
  const language = useSettingsStore((s) => s.language);
  const t = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "p") {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
        setSel(0);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const commands = useMemo(() => buildCommands(t), [t, language]);
  const files = useMemo(() => flattenFiles(tree), [tree]);

  const q = query.trim().toLowerCase();
  const items: PaletteItem[] = useMemo(
    () => filterPalette(files, commands, query),
    [files, commands, query],
  );

  useEffect(() => {
    setSel(0);
  }, [q]);

  if (!open) return null;

  const runItem = async (item: PaletteItem) => {
    setOpen(false);
    if (item.kind === "command") {
      item.cmd.run();
      return;
    }
    if (item.kind === "create") {
      void createAndOpenNote(item.name);
      return;
    }
    if (!vaultRoot) return;
    try {
      const content = await readFile(vaultRoot, item.path);
      openDoc(item.name, item.path);
      setContent(content);
    } catch {
      // read failed — leave as is
    }
  };

  const select = (delta: number) => {
    setSel((s) => Math.max(0, Math.min(items.length - 1, s + delta)));
  };

  return (
    <div
      style={{
        position: "fixed", top: "15%", left: "30%", width: "40%", maxHeight: "60%",
        background: "var(--bg)", boxShadow: "0 4px 24px rgba(0,0,0,0.25)", borderRadius: 8,
        zIndex: 1000, overflow: "hidden", display: "flex", flexDirection: "column",
      }}
    >
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); select(1); }
          else if (e.key === "ArrowUp") { e.preventDefault(); select(-1); }
          else if (e.key === "Enter" && items[sel]) { e.preventDefault(); void runItem(items[sel]); }
        }}
        placeholder={t.palettePlaceholder}
        style={{
          width: "100%", boxSizing: "border-box", padding: "10px 14px",
          fontSize: 15, border: "none", outline: "none", borderBottom: "1px solid var(--border)",
          background: "var(--bg)", color: "var(--fg)",
        }}
      />
      <div style={{ overflow: "auto", flex: 1 }}>
        {items.length === 0 && (
          <div style={{ padding: "8px 14px", fontSize: 13, color: "var(--fg-muted)" }}>
            {t.paletteNoMatches}
          </div>
        )}
        {items.map((item, i) => {
          const active = i === sel;
          const rowStyle = {
            padding: "6px 14px", cursor: "pointer", borderBottom: "1px solid var(--border)", fontSize: 14,
            background: active ? "var(--accent)" : "transparent",
            color: active ? "var(--accent-fg)" : "var(--fg)",
          } as const;
          if (item.kind === "file") {
            return (
              <div key={item.path} style={rowStyle} onClick={() => void runItem(item)}>
                <span style={{ marginRight: 6, opacity: 0.7 }}>📄</span>
                {item.name}
              </div>
            );
          }
          if (item.kind === "create") {
            return (
              <div key="create" style={rowStyle} onClick={() => void runItem(item)}>
                <span style={{ marginRight: 6, opacity: 0.7 }}>✨</span>
                {t.paletteCreateNote(item.name)}
              </div>
            );
          }
          return (
            <div key={item.cmd.id} style={rowStyle} onClick={() => void runItem(item)}>
              <span style={{ marginRight: 6, opacity: 0.7 }}>⚡</span>
              <span>{item.cmd.title}</span>
              {item.cmd.shortcut && (
                <span style={{ float: "right", opacity: 0.6, fontSize: 12 }}>{item.cmd.shortcut}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
