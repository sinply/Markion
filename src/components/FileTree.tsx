import { useCallback } from "react";
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
  return (
    <div
      style={{ ...style, display: "flex", alignItems: "center", paddingLeft: 4, cursor: "pointer" }}
      ref={dragHandle}
    >
      <span style={{ marginRight: 4, fontSize: 14 }}>
        {node.data.kind === "folder" ? "\u{1F4C1}" : "\u{1F4C4}"}
      </span>
      <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {node.data.name}
      </span>
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
      if (d.kind !== "file" || !vaultRoot) return;
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

  if (!tree) {
    return <div style={{ padding: 8, color: "#999", fontSize: 13 }}>No vault open</div>;
  }

  const rowData: RowData[] = tree.children.map(convertTree);

  return (
    <div style={{ height: "100%", overflow: "auto" }}>
      <div style={{ padding: "6px 8px", borderBottom: "1px solid #ddd", fontSize: 12, color: "#666" }}>
        {tree.name || "Vault"}
      </div>
      <Tree<RowData>
        data={rowData}
        width="100%"
        height={window.innerHeight - 40}
        rowHeight={28}
        onMove={handleMove}
        onActivate={handleActivate}
      >
        {NodeView}
      </Tree>
    </div>
  );
}
