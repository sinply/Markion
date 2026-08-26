import { create } from "zustand";
import type { TreeNode } from "../lib/types";
import { buildTree, reorderInFolder, setCollapsed, moveNode } from "../lib/ipc";

const DEFAULT_VAULT_KEY = "markion.defaultVault";
const RECENT_VAULTS_KEY = "markion.recentVaults";
const MAX_RECENT_VAULTS = 8;

/** Recursively drop dot-files / dot-folders (.markion, .obsidian, …). Applied
 *  at the store level so EVERY view (tree, palette, container lists) inherits
 *  the hidden-files setting, not just the file tree rendering. */
function filterHiddenFiles(node: TreeNode): TreeNode {
  return {
    ...node,
    children: node.children
      .filter((c) => !c.name.startsWith("."))
      .map(filterHiddenFiles),
  };
}

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

function clearDefaultVault() {
  try {
    localStorage.removeItem(DEFAULT_VAULT_KEY);
  } catch {
    // ignore
  }
}

/** Recently opened vaults (most recent first), for multi-vault switching. */
export function loadRecentVaults(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_VAULTS_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function saveRecentVaults(list: string[]) {
  try {
    localStorage.setItem(RECENT_VAULTS_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

interface VaultState {
  vaultRoot: string | null;
  tree: TreeNode | null;
  expanded: Record<string, boolean>;
  /** Recently opened vault paths (most recent first). */
  recentVaults: string[];
  loadTree: (root: string) => Promise<void>;
  /** Load the vault without touching the default. */
  openVault: (root: string) => Promise<void>;
  /** Explicitly pin the current vault as the default. */
  setAsDefault: () => void;
  /** Remove the default vault pin. */
  clearDefault: () => void;
  /** Set a specific path as the default vault (from Settings). */
  setDefaultTo: (root: string) => void;
  /** Record a vault in the recent list (called on open/switch). */
  addRecentVault: (root: string) => void;
  /** Remove a vault from the recent list (forget). */
  forgetVault: (root: string) => void;
  /** Switch the whole app to another vault: tree + settings + watcher, and
   *  drop every open tab (they belong to the old vault). */
  switchVault: (root: string) => Promise<void>;
  applyReorder: (folderRel: string, name: string, newIndex: number) => Promise<void>;
  applyMove: (fromFolder: string, fromName: string, toFolder: string, toName: string) => Promise<void>;
  setCollapsed: (folderRel: string, collapsed: boolean) => Promise<void>;
}

/** Monotonic request id so a slow earlier loadTree can't overwrite a newer
 *  tree (out-of-order async responses after rapid renames/deletes). */
let loadTreeSeq = 0;

export const useVaultStore = create<VaultState>((set, get) => ({
  vaultRoot: null,
  tree: null,
  expanded: {},
  recentVaults: loadRecentVaults(),

  loadTree: async (root) => {
    const seq = ++loadTreeSeq;
    const raw = await buildTree(root);
    if (seq !== loadTreeSeq) return; // a newer request superseded this one
    // Honor the "show hidden files" setting (defaults to off). Read lazily to
    // avoid a static import cycle with settingsStore.
    let showHidden = false;
    try {
      showHidden = (await import("./settingsStore")).useSettingsStore.getState()
        .showHiddenFiles;
    } catch {
      // settings not available - keep the safe default
    }
    const tree = showHidden ? raw : filterHiddenFiles(raw);
    set({ vaultRoot: root, tree });
    get().addRecentVault(root);
  },

  openVault: async (root) => {
    await get().loadTree(root);
  },

  setAsDefault: () => {
    const root = get().vaultRoot;
    if (root) setDefaultVault(root);
  },

  clearDefault: () => clearDefaultVault(),

  setDefaultTo: (root) => setDefaultVault(root),

  addRecentVault: (root) => {
    const next = [root, ...get().recentVaults.filter((v) => v !== root)].slice(0, MAX_RECENT_VAULTS);
    saveRecentVaults(next);
    set({ recentVaults: next });
  },

  forgetVault: (root) => {
    const next = get().recentVaults.filter((v) => v !== root);
    saveRecentVaults(next);
    set({ recentVaults: next });
  },

  switchVault: async (root) => {
    // Persist every dirty doc BEFORE dropping the tabs — reset() would
    // otherwise discard pending edits silently (the autosave timer cannot
    // save a doc that is no longer open).
    try {
      const { flushAllDirty } = await import("../lib/docSave");
      await flushAllDirty();
    } catch {
      // best-effort: a failed flush must not block the vault switch
    }
    await get().loadTree(root);
    const { useDocStore } = await import("./docStore");
    useDocStore.getState().reset();
    // Cross-vault leftovers: a pendingJump/conflict/deletedDoc pointing at a
    // path in the OLD vault must not fire against the new one.
    const { useUiStore } = await import("./uiStore");
    const ui = useUiStore.getState();
    ui.setPendingJump(null);
    ui.setConflict(null);
    ui.setDeletedDoc(null);
    const { useSettingsStore } = await import("./settingsStore");
    await useSettingsStore.getState().load(root);
    try {
      const { startVaultWatch } = await import("../lib/ipc");
      await startVaultWatch(root);
    } catch {
      // watcher restart is best-effort
    }
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
