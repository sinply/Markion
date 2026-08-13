import { useCallback, useMemo } from "react";
import { Tree } from "react-arborist";
import type { NodeRendererProps } from "react-arborist";
import { useVaultStore } from "../stores/vaultStore";
import { useDocStore } from "../stores/docStore";
import { useSettingsStore } from "../stores/settingsStore";
import { readFile } from "../lib/ipc";

interface RowData {
  id: string;
  name: string;
  children?: RowData[];
  kind: "file" | "folder";
}

/** A file is hidden (dotfile) if its basename starts with `.` (except `.markion`? no — all dotfiles hidden by default). */
function isDot(name: string): boolean {
  return name.startsWith(".");
}

function convertTree(
  node: { name: string; path: string; kind: "file" | "folder"; children: any[] },
  showHidden: boolean,
): RowData {
  return {
    id: node.path,
    name: node.name,
    kind: node.kind,
    children:
      node.kind === "folder"
        ? node.children
            .filter((c) => showHidden || !isDot(c.name))
            .map((c) => convertTree(c, showHidden))
        : undefined,
  };
}

function NodeView({ node, style, dragHandle }: NodeRendererProps<RowData>) {
  const isFolder = node.data.kind === "folder";
  const hasIndex =
    isFolder &&
    !!node.data.children?.some((c) => c.name === "index.md" && c.kind === "file");
  return (
    <div
      style={{
        ...style,
        display: "flex",
        alignItems: "center",
        cursor: isFolder ? "default" : "pointer",
      }}
      ref={dragHandle}
      onDoubleClick={isFolder ? (e) => { e.stopPropagation(); node.toggle(); } : undefined}
      title={
        isFolder
          ? hasIndex
            ? "Click to open index.md · double-click to expand"
            : node.isOpen
              ? "Double-click to collapse"
              : "Double-click to expand"
          : node.data.name
      }
    >
      <span
        onClick={isFolder ? (e) => { e.stopPropagation(); node.toggle(); } : undefined}
        style={{
          marginRight: 2,
          fontSize: 10,
          width: 12,
          display: "inline-block",
          color: "#888",
          cursor: isFolder ? "pointer" : "default",
          userSelect: "none",
        }}
      >
        {isFolder ? (node.isOpen ? "▾" : "▸") : ""}
      </span>
      <span style={{ marginRight: 4, display: "inline-flex", flexShrink: 0 }}>
        {isFolder ? (
          node.isOpen ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#2ea043" fillOpacity="0.15" stroke="#2ea043" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#2ea043" fillOpacity="0.15" stroke="#2ea043" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <path d="M9 13l3 3 3-3" />
            </svg>
          )
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--fg-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        )}
      </span>
      <span
        style={{
          fontSize: 13,
          fontWeight: isFolder ? 600 : 400,
          color: isFolder ? "var(--fg)" : "var(--fg-muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {node.data.name}
      </span>
      {hasIndex && (
        <span
          style={{
            marginLeft: 6,
            fontSize: 9,
            color: "var(--fg-muted)",
            border: "1px solid var(--border)",
            borderRadius: 3,
            padding: "0 4px",
            opacity: 0.8,
          }}
        >
          index
        </span>
      )}
    </div>
  );
}

export function FileTree() {
  const tree = useVaultStore((s) => s.tree);
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const applyReorder = useVaultStore((s) => s.applyReorder);
  const applyMove = useVaultStore((s) => s.applyMove);
  const openDoc = useDocStore((s) => s.openDoc);
  const setActiveContent = useDocStore((s) => s.setActiveContent);
  const showHidden = useSettingsStore((s) => s.showHiddenFiles);

  const handleActivate = useCallback(
    async (node: any) => {
      const d = node.data;
      if (!vaultRoot) return;
      // A folder with an index.md opens that file (folder-as-container body).
      if (d.kind === "folder") {
        const index = d.children?.find((c: any) => c.name === "index.md" && c.kind === "file");
        if (!index) return; // no index.md: keep default folder behavior
        const content = await readFile(vaultRoot, index.id);
        openDoc(index.name, index.id);
        setActiveContent(content);
        return;
      }
      if (d.kind !== "file") return;
      const content = await readFile(vaultRoot, d.id);
      openDoc(d.name, d.id);
      setActiveContent(content);
    },
    [vaultRoot, openDoc, setActiveContent],
  );

  const handleMove = useCallback(
    ({ dragIds, parentId, index, dragNodes }: any) => {
      const name = String(dragIds[0]);
      const srcParent = dragNodes?.[0]?.parent?.id ?? "";
      const destParent = parentId ?? "";
      if (srcParent !== destParent && destParent) {
        applyMove(srcParent, name, destParent, name);
      } else {
        applyReorder(destParent, name, index);
      }
    },
    [applyReorder, applyMove],
  );

  // Default: all folders collapsed, showing only the top level
  const initialOpenState = useMemo(() => {
    const map: Record<string, boolean> = {};
    if (tree) {
      const visit = (children: { name: string; path: string; kind: string; children: any[] }[]) => {
        for (const c of children) {
          if (c.kind === "folder") {
            map[c.path] = false; // collapsed by default
            visit(c.children);
          }
        }
      };
      visit(tree.children);
    }
    return map;
  }, [tree]);

  if (!tree) {
    return <div style={{ padding: 8, color: "var(--fg-muted)", fontSize: 13 }}>No vault open</div>;
  }

  const rowData: RowData[] = tree.children
    .filter((c) => showHidden || !isDot(c.name))
    .map((c) => convertTree(c, showHidden));

  return (
    <div style={{ height: "100%", overflow: "auto" }}>
      <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", fontSize: 12, color: "var(--fg-muted)" }}>
        {tree.name || "Vault"}
      </div>
      <Tree<RowData>
        data={rowData}
        width="100%"
        height={window.innerHeight - 40}
        rowHeight={28}
        initialOpenState={initialOpenState}
        onMove={handleMove}
        onActivate={handleActivate}
      >
        {NodeView}
      </Tree>
    </div>
  );
}
