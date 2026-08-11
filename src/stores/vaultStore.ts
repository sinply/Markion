import { create } from "zustand";
import type { TreeNode } from "../lib/types";
import { buildTree, reorderInFolder, setCollapsed, moveNode } from "../lib/ipc";

const DEFAULT_VAULT_KEY = "markion.defaultVault";

/** Persist the default vault path (last opened) so the app can reopen it. */
export function getDefaultVault(): string | null {
  try {
    return localStorage.getItem(DEFAULT_VAULT_KEY);
  } catch {
    return null;
  }
}

function setDefaultVault(vaultRoot: string) {
  try {
    localStorage.setItem(DEFAULT_VAULT_KEY, vaultRoot);
  } catch {
    // ignore storage errors
  }
}

interface VaultState {
  vaultRoot: string | null;
  tree: TreeNode | null;
  expanded: Record<string, boolean>;
  loadTree: (root: string) => Promise<void>;
  /** Load and remember as the default vault. */
  openVault: (root: string) => Promise<void>;
  /** Explicitly pin the current vault as the default (File → Set as Default Vault). */
  setAsDefault: () => void;
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

  openVault: async (root) => {
    await get().loadTree(root);
    setDefaultVault(root);
  },

  setAsDefault: () => {
    const root = get().vaultRoot;
    if (root) setDefaultVault(root);
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
