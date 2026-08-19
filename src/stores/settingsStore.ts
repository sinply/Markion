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

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,

  load: async (vaultRoot) => {
    try {
      const { readConfig } = await import("../lib/ipc");
      const s = await readConfig(vaultRoot);
      set(s);
    } catch {
      // IPC not available yet (backend missing read_config); use defaults
    }
  },

  save: async (vaultRoot) => {
    try {
      const { saveConfig } = await import("../lib/ipc");
      const { load, save, setTheme, setAssetsStrategy, setPathStyle, setTemplateFolder, setShowHiddenFiles, setLivePreview, setLanguage, setFont, setShowOutline, setShowBacklinks, setShowGraph, setShowTags, setShowWordCount, setShortcut, resetShortcuts, ...settings } = get();
      await saveConfig(vaultRoot, settings as Settings);
    } catch {
      // IPC not available yet
    }
  },

  setTheme: (theme) => set({ theme }),
  setAssetsStrategy: (assetsStrategy) => set({ assetsStrategy }),
  setPathStyle: (pathStyle) => set({ pathStyle }),
  setTemplateFolder: (templateFolder) => set({ templateFolder }),
  setShowHiddenFiles: (showHiddenFiles) => set({ showHiddenFiles }),
  setLivePreview: (livePreview) => set({ livePreview }),
  setLanguage: (language) => set({ language }),
  setFont: (font) => set({ font }),
  setShowOutline: (showOutline) => set({ showOutline }),
  setShowBacklinks: (showBacklinks) => set({ showBacklinks }),
  setShowGraph: (showGraph) => set({ showGraph }),
  setShowTags: (showTags) => set({ showTags }),
  setShowWordCount: (showWordCount) => set({ showWordCount }),
  setShortcut: (id, combo) =>
    set((s) => ({ shortcuts: { ...s.shortcuts, [id]: combo } })),
  resetShortcuts: () => set({ shortcuts: {} }),
}));
