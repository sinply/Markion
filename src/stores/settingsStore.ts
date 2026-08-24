import { create } from "zustand";
import type { Settings } from "../lib/types";
import { DEFAULT_SETTINGS } from "../lib/types";

interface SettingsState extends Settings {
  load: (vaultRoot: string) => Promise<void>;
  save: (vaultRoot: string) => Promise<void>;
  setTheme: (t: Settings["theme"]) => void;
  setAssetsStrategy: (s: Settings["assetsStrategy"]) => void;
  setPathStyle: (p: Settings["pathStyle"]) => void;
  setTemplateFolder: (v: string) => void;
  setShowHiddenFiles: (v: boolean) => void;
  setShowDailyNote: (v: boolean) => void;
  setLivePreview: (v: boolean) => void;
  setLanguage: (l: Settings["language"]) => void;
  setFont: (f: Settings["font"]) => void;
  setShowOutline: (v: boolean) => void;
  setShowBacklinks: (v: boolean) => void;
  setShowGraph: (v: boolean) => void;
  setShowTags: (v: boolean) => void;
  setShowWordCount: (v: boolean) => void;
  setShortcut: (id: string, combo: string) => void;
  resetShortcuts: () => void;
}

/** Write the current settings to the active vault's config.json. Called after
 *  EVERY mutation — settings used to live only in memory and were lost on
 *  restart, because nothing ever invoked `save`. */
async function persistSettings(): Promise<void> {
  try {
    const { useVaultStore } = await import("./vaultStore");
    const root = useVaultStore.getState().vaultRoot;
    if (!root) return; // no vault open yet (e.g. first-run picker) — skip
    await useSettingsStore.getState().save(root);
  } catch {
    // persistence is best-effort; never block a UI toggle
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,

  load: async (vaultRoot) => {
    try {
      const { readConfig } = await import("../lib/ipc");
      const s = await readConfig(vaultRoot);
      set(s);
      // The first loadTree runs before settings arrive and hides dotfiles by
      // default; if this vault shows them, refresh the tree once.
      if (s.showHiddenFiles) {
        const { useVaultStore } = await import("./vaultStore");
        const vs = useVaultStore.getState();
        if (vs.vaultRoot) await vs.loadTree(vs.vaultRoot);
      }
    } catch {
      // IPC not available yet (backend missing read_config); use defaults
    }
  },

  save: async (vaultRoot) => {
    try {
      const { saveConfig } = await import("../lib/ipc");
      const { load, save, setTheme, setAssetsStrategy, setPathStyle, setTemplateFolder, setShowHiddenFiles, setShowDailyNote, setLivePreview, setLanguage, setFont, setShowOutline, setShowBacklinks, setShowGraph, setShowTags, setShowWordCount, setShortcut, resetShortcuts, ...settings } = get();
      await saveConfig(vaultRoot, settings as Settings);
    } catch {
      // IPC not available yet
    }
  },

  setTheme: (theme) => { set({ theme }); void persistSettings(); },
  setAssetsStrategy: (assetsStrategy) => { set({ assetsStrategy }); void persistSettings(); },
  setPathStyle: (pathStyle) => { set({ pathStyle }); void persistSettings(); },
  setTemplateFolder: (templateFolder) => { set({ templateFolder }); void persistSettings(); },
  setShowHiddenFiles: (showHiddenFiles) => { set({ showHiddenFiles }); void persistSettings(); },
  setShowDailyNote: (showDailyNote) => { set({ showDailyNote }); void persistSettings(); },
  setLivePreview: (livePreview) => { set({ livePreview }); void persistSettings(); },
  setLanguage: (language) => { set({ language }); void persistSettings(); },
  setFont: (font) => { set({ font }); void persistSettings(); },
  setShowOutline: (showOutline) => { set({ showOutline }); void persistSettings(); },
  setShowBacklinks: (showBacklinks) => { set({ showBacklinks }); void persistSettings(); },
  setShowGraph: (showGraph) => { set({ showGraph }); void persistSettings(); },
  setShowTags: (showTags) => { set({ showTags }); void persistSettings(); },
  setShowWordCount: (showWordCount) => { set({ showWordCount }); void persistSettings(); },
  setShortcut: (id, combo) => {
    set((s) => ({ shortcuts: { ...s.shortcuts, [id]: combo } }));
    void persistSettings();
  },
  resetShortcuts: () => {
    set({ shortcuts: {} });
    void persistSettings();
  },
}));
