import { useCallback, useMemo } from "react";
import { Tree } from "react-arborist";
import type { NodeRendererProps } from "react-arborist";
import { useVaultStore } from "../stores/vaultStore";
import { useDocStore } from "../stores/docStore";
import { readFile } from "../lib/ipc";

interface RowData {
  id: string;
  name: string;
  children?: RowData[];
  kind: "file" | "folder";
}

function convertTree(node: { name: string; path: string; kind: "file" | "folder"; children: any[] }): RowData {
  return {
    id: node.path,
    name: node.name,
    kind: node.kind,
    children: node.kind === "folder" ? node.children.map(convertTree) : undefined,
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
      title={
        isFolder
          ? hasIndex
            ? "Click name to open index.md (folder body)"
            : node.isOpen
              ? "Collapse"
              : "Expand"
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
      <span style={{ marginRight: 4, fontSize: 14 }}>
        {isFolder ? "\u{1F4C1}" : "\u{1F4C4}"}
      </span>
      <span
        style={{
          fontSize: 13,
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

  const rowData: RowData[] = tree.children.map(convertTree);

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
