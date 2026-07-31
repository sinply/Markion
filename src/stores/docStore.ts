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
  setActiveContent: (content: string) => void;
  activeContent: string;
}

export const useDocStore = create<DocState>((set, get) => ({
  openDocs: [],
  activeDocId: null,
  dirtyMap: {},
  activeContent: "",

  openDoc: (title, path) => {
    const existing = get().openDocs.find((d) => d.path === path);
    if (existing) {
      set({ activeDocId: existing.id, activeContent: "" });
      return;
    }
    const id = path;
    set((s) => ({
      openDocs: [...s.openDocs, { id, path, title }],
      activeDocId: id,
      activeContent: "",
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
        activeContent: newActive ? s.activeContent : "",
      };
    });
  },

  switchTo: (id) => {
    set({ activeDocId: id, activeContent: "" });
  },

  markDirty: (id) =>
    set((s) => ({ dirtyMap: { ...s.dirtyMap, [id]: true } })),
  markClean: (id) =>
    set((s) => ({ dirtyMap: { ...s.dirtyMap, [id]: false } })),

  setActiveContent: (content) => set({ activeContent: content }),
}));
