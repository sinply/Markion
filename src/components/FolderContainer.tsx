import { useEffect, useState } from "react";
import { useVaultStore } from "../stores/vaultStore";
import { useDocStore } from "../stores/docStore";
import { useI18n } from "../lib/i18n";
import { openNote } from "../lib/openNote";
import { docTitle } from "../lib/docTitle";
import { FolderTableView } from "./FolderTableDialog";
import type { TreeNode } from "../lib/types";

/** Find a folder node by its relative path (depth-first). */
function findFolder(node: TreeNode | null, path: string): TreeNode | null {
  if (!node || !node.children) return null;
  for (const c of node.children) {
    if (c.kind === "folder") {
      if (c.path === path) return c;
      const hit = findFolder(c, path);
      if (hit) return hit;
    }
  }
  return null;
}

/** Folder-as-container body: when the active doc is a folder's `index.md`,
 *  show the folder's other notes below the editor so the folder reads as one
 *  page with its children (Yuque-style). Toggleable between a compact list
 *  and the folder's auto-derived data table. */
export function FolderContainer() {
  const tree = useVaultStore((s) => s.tree);
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const activeDocId = useDocStore((s) => s.activeDocId);
  const openDocs = useDocStore((s) => s.openDocs);
  const t = useI18n();
  const [mode, setMode] = useState<"list" | "table">("list");

  const active = openDocs.find((d) => d.id === activeDocId);
  // Container mode keys on the PATH (the storage truth), never the display
  // title — titles are extension-free since the docTitle conversion layer.
  const activeBase = active ? active.path.split("/").pop() ?? "" : "";
  if (!active || !/^index\.md$/i.test(activeBase)) return null;

  const slash = active.path.lastIndexOf("/");
  const folderRel = slash > 0 ? active.path.slice(0, slash) : "";
  const folder = tree ? findFolder(tree, folderRel) : null;
  if (!folder || !folder.children) return null;

  const notes = folder.children.filter(
    (c) => c.kind === "file" && !/^index\.md$/i.test(c.name),
  );

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        padding: "8px 16px",
        maxHeight: mode === "table" ? 300 : 220,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--panel-bg)",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 12, color: "var(--fg-muted)", flex: 1 }}>
          {t.containerTitle} ({notes.length})
        </div>
        {/* List / table toggle (Yuque-style folder-as-database). */}
        <button
          onClick={() => setMode(mode === "list" ? "table" : "list")}
          title={mode === "list" ? t.viewAsTable : t.containerListView}
          style={{
            background: "none",
            border: "1px solid var(--border)",
            borderRadius: 4,
            color: "var(--fg-muted)",
            cursor: "pointer",
            fontSize: 11,
            lineHeight: 1,
            padding: "3px 7px",
          }}
        >
          {mode === "list" ? "▦" : "☰"}
        </button>
      </div>

      {mode === "table" ? (
        <div style={{ flex: 1, minHeight: 0 }}>
          <FolderTableView folder={folderRel} />
        </div>
      ) : (
        <>
          {notes.length === 0 && (
            <div style={{ color: "var(--fg-muted)", fontSize: 13 }}>{t.containerEmpty}</div>
          )}
          {notes.map((c) => (
            <div
              key={c.path}
              onClick={() => {
                if (vaultRoot) void openNote(vaultRoot, c.path);
              }}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                padding: "3px 4px",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 13,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background =
                  "var(--hover-bg, rgba(128,128,128,0.12))";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              <span style={{ opacity: 0.7 }}>📄</span>
              <span>{docTitle(c.name)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
