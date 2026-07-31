import { create } from "zustand";
import type { TreeNode } from "../lib/types";
import { buildTree, reorderInFolder, setCollapsed, moveNode } from "../lib/ipc";

interface VaultState {
  vaultRoot: string | null;
  tree: TreeNode | null;
  expanded: Record<string, boolean>;
  loadTree: (root: string) => Promise<void>;
  applyReorder: (folderRel: string, name: string, newIndex: number) => Promise<void>;
  applyMove: (fromFolder: string, fromName: string, toFolder: string, toName: string) => Promise<void>;
  setCollapsed: (folderRel: string, collapsed: boolean) => Promise<void>;
}

export const useVaultStore = create<VaultState>((set, get) => ({
  vaultRoot: null,
  tree: null,
  expanded: {},

  loadTree: async (root) => {
    const tree = await buildTree(root);
    set({ vaultRoot: root, tree });
  },

  applyReorder: async (folderRel, name, newIndex) => {
    const root = get().vaultRoot;
    if (!root) return;
    await reorderInFolder(root, folderRel, name, newIndex);
    await get().loadTree(root);
  },

  applyMove: async (fromFolder, fromName, toFolder, toName) => {
    const root = get().vaultRoot;
    if (!root) return;
    await moveNode(root, fromFolder, fromName, toFolder, toName);
    await get().loadTree(root);
  },

  setCollapsed: async (folderRel, collapsed) => {
    const root = get().vaultRoot;
    if (!root) return;
    await setCollapsed(root, folderRel, collapsed);
    set((s) => ({ expanded: { ...s.expanded, [folderRel]: collapsed } }));
  },
}));
