import { useEffect } from "react";
import { useVaultStore } from "../stores/vaultStore";
import { setWikiIndex, type WikiFile } from "../editor/wikiIndex";
import type { TreeNode } from "../lib/types";

/** Flatten the tree's markdown files (path-qualified names) for the wiki index. */
function flattenFiles(node: TreeNode): WikiFile[] {
  const out: WikiFile[] = [];
  const walk = (n: TreeNode) => {
    if (n.kind === "file") out.push({ name: n.name, path: n.path });
    else n.children.forEach(walk);
  };
  walk(node);
  return out;
}

/** Keep the wikilink resolution index in sync with the vault tree. */
export function useWikiIndex() {
  const tree = useVaultStore((s) => s.tree);
  useEffect(() => {
    setWikiIndex(tree ? flattenFiles(tree) : []);
  }, [tree]);
}
