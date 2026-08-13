import { create } from "zustand";

export interface OpenDoc {
  id: string;
  path: string;
  title: string;
}

interface DocState {
  openDocs: OpenDoc[];
  activeDocId: string | null;
  dirtyMap: Record<string, boolean>;
  openDoc: (title: string, path: string) => void;
  closeDoc: (id: string) => void;
  switchTo: (id: string) => void;
  markDirty: (id: string) => void;
  markClean: (id: string) => void;
  /** Record the exact content last written to disk for a doc, so external-change
   *  detection can tell our own autosave echo from a real external edit. */
  markSaved: (id: string, content: string) => void;
  savedContent: Record<string, string>;
  setActiveContent: (content: string) => void;
  activeContent: string;
  /** Which doc the activeContent belongs to (so switching tabs reloads the right file). */
  activeContentDocId: string | null;
}

export const useDocStore = create<DocState>((set, get) => ({
  openDocs: [],
  activeDocId: null,
  dirtyMap: {},
  savedContent: {},
  activeContent: "",
  activeContentDocId: null,

  openDoc: (title, path) => {
    const existing = get().openDocs.find((d) => d.path === path);
    if (existing) {
      set({ activeDocId: existing.id });
      return;
    }
    const id = path;
    set((s) => ({
      openDocs: [...s.openDocs, { id, path, title }],
      activeDocId: id,
    }));
  },

  closeDoc: (id) => {
    set((s) => {
      const newDocs = s.openDocs.filter((d) => d.id !== id);
      let newActive = s.activeDocId;
      if (s.activeDocId === id) {
        const idx = s.openDocs.findIndex((d) => d.id === id);
        newActive = newDocs[Math.min(idx, newDocs.length - 1)]?.id ?? null;
      }
      const newDirty = { ...s.dirtyMap } as Record<string, boolean | undefined>;
      delete newDirty[id];
      return {
        openDocs: newDocs,
        activeDocId: newActive,
        dirtyMap: newDirty as Record<string, boolean>,
        // Content for the closed doc is stale; clear it so the editor reloads.
        activeContent: newActive === s.activeContentDocId ? s.activeContent : "",
        activeContentDocId: newActive === s.activeContentDocId ? s.activeContentDocId : null,
      };
    });
  },

  switchTo: (id) => {
    set({ activeDocId: id });
  },

  markDirty: (id) =>
    set((s) => ({ dirtyMap: { ...s.dirtyMap, [id]: true } })),
  markClean: (id) =>
    set((s) => ({ dirtyMap: { ...s.dirtyMap, [id]: false } })),
  markSaved: (id, content) =>
    set((s) => ({ savedContent: { ...s.savedContent, [id]: content } })),

  setActiveContent: (content) =>
    set((s) => ({ activeContent: content, activeContentDocId: s.activeDocId })),
}));
