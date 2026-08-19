import { create } from "zustand";
import type { EditorMode } from "../editor/codemirror";
import type { MarkdownCommand } from "../editor/commands";

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

  editTick: number;
  editCmd: "undo" | "redo" | "selectAll" | "copy" | "cut" | "paste" | "find";
  requestEdit: (cmd: "undo" | "redo" | "selectAll" | "copy" | "cut" | "paste" | "find") => void;

  mdTick: number;
  mdCmd: MarkdownCommand;
  requestMarkdown: (cmd: MarkdownCommand) => void;

  recentFiles: string[];
  addRecent: (path: string) => void;
  clearRecent: () => void;

  /** Recently closed tabs (most recent first, capped). Reopened via the
   *  "Reopen Closed Tab" command (Ctrl+Shift+T). */
  recentlyClosed: { title: string; path: string }[];
  addRecentlyClosed: (d: { title: string; path: string }) => void;
  /** Pop the most recently closed tab (consumed by the reopen command). */
  takeRecentlyClosed: () => { title: string; path: string } | null;

  aboutOpen: boolean;
  setAboutOpen: (b: boolean) => void;

  settingsOpen: boolean;
  setSettingsOpen: (b: boolean) => void;

  helpOpen: boolean;
  setHelpOpen: (b: boolean) => void;

  shortcutsOpen: boolean;
  setShortcutsOpen: (b: boolean) => void;

  /** Vault-wide full-text search dialog (Ctrl+Shift+F). */
  searchOpen: boolean;
  setSearchOpen: (b: boolean) => void;

  /** Template picker dialog (insert a template at the cursor). */
  templatesOpen: boolean;
  setTemplatesOpen: (b: boolean) => void;

  /** Properties editor for the active doc's YAML frontmatter. */
  propertiesOpen: boolean;
  setPropertiesOpen: (b: boolean) => void;

  /** Vault-internal trash viewer (restore deleted files). */
  trashOpen: boolean;
  setTrashOpen: (b: boolean) => void;

  /** Focus mode: active-line highlight + typewriter centering (session-only). */
  focusMode: boolean;
  setFocusMode: (b: boolean) => void;

  /** Cursor jump requested by the search dialog: { path, line, column }. The
   *  editor consumes it once the target doc's content is active. */
  pendingJump: { path: string; line: number; column: number } | null;
  setPendingJump: (j: { path: string; line: number; column: number } | null) => void;

  /** External-change conflict: a dirty doc was modified on disk. The dialog
   *  subscribes; resolving the conflict clears it. */
  conflict: { path: string; diskContent: string } | null;
  setConflict: (c: { path: string; diskContent: string } | null) => void;

  /** A dirty doc was deleted on disk. The dialog offers Save As… / discard.
   *  `content` is the unsaved editor content so Save As has something to write. */
  deletedDoc: { path: string; title: string; content: string } | null;
  setDeletedDoc: (d: { path: string; title: string; content: string } | null) => void;
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

  editTick: 0,
  editCmd: "undo",
  requestEdit: (editCmd) => set((s) => ({ editTick: s.editTick + 1, editCmd })),

  mdTick: 0,
  mdCmd: "bold",
  requestMarkdown: (mdCmd) => set((s) => ({ mdTick: s.mdTick + 1, mdCmd })),

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

  recentlyClosed: [],
  addRecentlyClosed: (d) =>
    set((s) => ({ recentlyClosed: [d, ...s.recentlyClosed].slice(0, 10) })),
  takeRecentlyClosed: () => {
    const top = get().recentlyClosed[0] ?? null;
    if (top) set((s) => ({ recentlyClosed: s.recentlyClosed.slice(1) }));
    return top;
  },

  aboutOpen: false,
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  helpOpen: false,
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),

  searchOpen: false,
  setSearchOpen: (searchOpen) => set({ searchOpen }),

  templatesOpen: false,
  setTemplatesOpen: (templatesOpen) => set({ templatesOpen }),

  propertiesOpen: false,
  setPropertiesOpen: (propertiesOpen) => set({ propertiesOpen }),

  trashOpen: false,
  setTrashOpen: (trashOpen) => set({ trashOpen }),

  focusMode: false,
  setFocusMode: (focusMode) => set({ focusMode }),

  pendingJump: null,
  setPendingJump: (pendingJump) => set({ pendingJump }),

  conflict: null,
  setConflict: (conflict) => set({ conflict }),

  deletedDoc: null,
  setDeletedDoc: (deletedDoc) => set({ deletedDoc }),
}));
