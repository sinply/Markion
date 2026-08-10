import { create } from "zustand";
import type { EditorMode } from "../editor/codemirror";

const RECENT_KEY = "markion.recentFiles";
const MAX_RECENT = 10;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

interface UiState {
  editorMode: EditorMode;
  setEditorMode: (m: EditorMode) => void;

  // command signals (incremented by the menu bar, consumed via effect)
  openFolderTick: number;
  requestOpenFolder: () => void;
  openFileTick: number;
  requestOpenFile: () => void;
  saveTick: number;
  requestSave: () => void;
  saveAsTick: number;
  requestSaveAs: () => void;

  recentFiles: string[];
  addRecent: (path: string) => void;
  clearRecent: () => void;

  aboutOpen: boolean;
  setAboutOpen: (b: boolean) => void;

  settingsOpen: boolean;
  setSettingsOpen: (b: boolean) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  editorMode: "live",
  setEditorMode: (editorMode) => set({ editorMode }),

  openFolderTick: 0,
  requestOpenFolder: () => set((s) => ({ openFolderTick: s.openFolderTick + 1 })),
  openFileTick: 0,
  requestOpenFile: () => set((s) => ({ openFileTick: s.openFileTick + 1 })),
  saveTick: 0,
  requestSave: () => set((s) => ({ saveTick: s.saveTick + 1 })),
  saveAsTick: 0,
  requestSaveAs: () => set((s) => ({ saveAsTick: s.saveAsTick + 1 })),

  recentFiles: loadRecent(),
  addRecent: (path) => {
    const cur = get().recentFiles.filter((p) => p !== path);
    const next = [path, ...cur].slice(0, MAX_RECENT);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
    set({ recentFiles: next });
  },
  clearRecent: () => {
    try {
      localStorage.removeItem(RECENT_KEY);
    } catch {
      // ignore
    }
    set({ recentFiles: [] });
  },

  aboutOpen: false,
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
}));
