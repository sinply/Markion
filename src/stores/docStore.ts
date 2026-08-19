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
  /** Close every open doc whose path equals `path` or lives under it
   *  (deleting a folder closes its contained docs too). */
  closeDocsUnder: (path: string) => void;
  /** Update the path/title of an open doc after a file rename. The doc id
   *  (== path), tab title, and per-doc maps all move to the new key. */
  renameDoc: (oldPath: string, newPath: string, newTitle: string) => void;
  /** Close every doc and clear content (vault switch). */
  reset: () => void;
  switchTo: (id: string) => void;
  /** Move the tab `fromId` to the position of `toId` (drag-to-reorder). */
  reorderDocs: (fromId: string, toId: string) => void;
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

  reorderDocs: (fromId, toId) => {
    const docs = get().openDocs;
    const from = docs.findIndex((d) => d.id === fromId);
    const to = docs.findIndex((d) => d.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...docs];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    set({ openDocs: next });
  },

  closeDocsUnder: (path) => {
    // Prefix match on path segments so "notes" never matches "notes-2.md".
    const under = (docPath: string) =>
      docPath === path || docPath.startsWith(path.endsWith("/") ? path : path + "/");
    const docs = get().openDocs.filter((d) => !under(d.path));
    if (docs.length === get().openDocs.length) return;
    // Reuse closeDoc semantics per doc by filtering once and fixing up the
    // active doc / content pointers in a single set().
    const s = get();
    let newActive = s.activeDocId;
    if (s.activeDocId && !docs.some((d) => d.id === s.activeDocId)) {
      const idx = s.openDocs.findIndex((d) => d.id === s.activeDocId);
      newActive = docs[Math.min(idx, docs.length - 1)]?.id ?? null;
    }
    const newDirty: Record<string, boolean> = {};
    const newSaved: Record<string, string> = {};
    for (const d of docs) {
      if (s.dirtyMap[d.id] !== undefined) newDirty[d.id] = s.dirtyMap[d.id];
      if (s.savedContent[d.id] !== undefined) newSaved[d.id] = s.savedContent[d.id];
    }
    set({
      openDocs: docs,
      activeDocId: newActive,
      dirtyMap: newDirty,
      savedContent: newSaved,
      activeContent: newActive === s.activeContentDocId ? s.activeContent : "",
      activeContentDocId: newActive === s.activeContentDocId ? s.activeContentDocId : null,
    });
  },

  renameDoc: (oldPath, newPath, newTitle) => {
    const s = get();
    const doc = s.openDocs.find((d) => d.path === oldPath);
    if (!doc) return;
    const dirty = s.dirtyMap[oldPath];
    const saved = s.savedContent[oldPath];
    const dirtyMap = { ...s.dirtyMap };
    const savedContent = { ...s.savedContent };
    delete dirtyMap[oldPath];
    delete savedContent[oldPath];
    if (dirty !== undefined) dirtyMap[newPath] = dirty;
    if (saved !== undefined) savedContent[newPath] = saved;
    set({
      openDocs: s.openDocs.map((d) =>
        d.id === oldPath ? { id: newPath, path: newPath, title: newTitle } : d,
      ),
      activeDocId: s.activeDocId === oldPath ? newPath : s.activeDocId,
      activeContentDocId:
        s.activeContentDocId === oldPath ? newPath : s.activeContentDocId,
      dirtyMap,
      savedContent,
    });
  },

  reset: () =>
    set({
      openDocs: [],
      activeDocId: null,
      dirtyMap: {},
      savedContent: {},
      activeContent: "",
      activeContentDocId: null,
    }),

  markDirty: (id) =>
    set((s) => ({ dirtyMap: { ...s.dirtyMap, [id]: true } })),
  markClean: (id) =>
    set((s) => ({ dirtyMap: { ...s.dirtyMap, [id]: false } })),
  markSaved: (id, content) =>
    set((s) => ({ savedContent: { ...s.savedContent, [id]: content } })),

  setActiveContent: (content) =>
    set((s) => ({ activeContent: content, activeContentDocId: s.activeDocId })),
}));
