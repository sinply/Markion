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
  /** Latest known content per open doc ("draft"). Updated synchronously on
   *  every edit and whenever a doc's full content becomes known (open, load,
   *  save). The autosave/flush path writes THIS — never stale disk text — so
   *  switching tabs or re-activating a dirty doc cannot lose keystrokes. */
  drafts: Record<string, string>;
  /** Record `content` as the latest known content of doc `id`, mirroring it
   *  into activeContent when `id` is the active doc. */
  setDraft: (id: string, content: string) => void;
  /** Docs whose initial read from disk failed; they mount read-only so an
   *  empty buffer can never be autosaved over the real file. Cleared on the
   *  next successful load (switching away and back retries the read). */
  loadErrorMap: Record<string, boolean>;
  setLoadError: (id: string, failed: boolean) => void;
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
  drafts: {},
  loadErrorMap: {},
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
      const newDrafts = { ...s.drafts };
      delete newDrafts[id];
      const newLoadErrors = { ...s.loadErrorMap };
      delete newLoadErrors[id];
      return {
        openDocs: newDocs,
        activeDocId: newActive,
        dirtyMap: newDirty as Record<string, boolean>,
        drafts: newDrafts,
        loadErrorMap: newLoadErrors,
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
    const newDrafts: Record<string, string> = {};
    const newLoadErrors: Record<string, boolean> = {};
    for (const d of docs) {
      if (s.dirtyMap[d.id] !== undefined) newDirty[d.id] = s.dirtyMap[d.id];
      if (s.savedContent[d.id] !== undefined) newSaved[d.id] = s.savedContent[d.id];
      if (s.drafts[d.id] !== undefined) newDrafts[d.id] = s.drafts[d.id];
      if (s.loadErrorMap[d.id] !== undefined) newLoadErrors[d.id] = s.loadErrorMap[d.id];
    }
    set({
      openDocs: docs,
      activeDocId: newActive,
      dirtyMap: newDirty,
      savedContent: newSaved,
      drafts: newDrafts,
      loadErrorMap: newLoadErrors,
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
    const draft = s.drafts[oldPath];
    const loadError = s.loadErrorMap[oldPath];
    const dirtyMap = { ...s.dirtyMap };
    const savedContent = { ...s.savedContent };
    const drafts = { ...s.drafts };
    const loadErrorMap = { ...s.loadErrorMap };
    delete dirtyMap[oldPath];
    delete savedContent[oldPath];
    delete drafts[oldPath];
    delete loadErrorMap[oldPath];
    if (dirty !== undefined) dirtyMap[newPath] = dirty;
    if (saved !== undefined) savedContent[newPath] = saved;
    if (draft !== undefined) drafts[newPath] = draft;
    if (loadError !== undefined) loadErrorMap[newPath] = loadError;
    set({
      openDocs: s.openDocs.map((d) =>
        d.id === oldPath ? { id: newPath, path: newPath, title: newTitle } : d,
      ),
      activeDocId: s.activeDocId === oldPath ? newPath : s.activeDocId,
      activeContentDocId:
        s.activeContentDocId === oldPath ? newPath : s.activeContentDocId,
      dirtyMap,
      savedContent,
      drafts,
      loadErrorMap,
    });
  },

  reset: () =>
    set({
      openDocs: [],
      activeDocId: null,
      dirtyMap: {},
      savedContent: {},
      drafts: {},
      loadErrorMap: {},
      activeContent: "",
      activeContentDocId: null,
    }),

  markDirty: (id) =>
    set((s) => ({ dirtyMap: { ...s.dirtyMap, [id]: true } })),
  markClean: (id) =>
    set((s) => ({ dirtyMap: { ...s.dirtyMap, [id]: false } })),
  markSaved: (id, content) =>
    set((s) => ({
      savedContent: { ...s.savedContent, [id]: content },
      // The written bytes are by definition the latest known content.
      drafts: { ...s.drafts, [id]: content },
    })),

  setDraft: (id, content) =>
    set((s) => {
      const patches: Partial<DocState> = { drafts: { ...s.drafts, [id]: content } };
      if (s.activeDocId === id) {
        // Mirror into the active-content view so consumers that read
        // activeContent (exports, slideshow, properties dialog) stay current.
        patches.activeContent = content;
        patches.activeContentDocId = id;
      }
      return patches;
    }),

  setLoadError: (id, failed) =>
    set((s) => {
      const loadErrorMap = { ...s.loadErrorMap };
      if (failed) loadErrorMap[id] = true;
      else delete loadErrorMap[id];
      return { loadErrorMap };
    }),

  setActiveContent: (content) =>
    set((s) => ({
      activeContent: content,
      activeContentDocId: s.activeDocId,
      // A full-content assignment also becomes the doc's draft (open/load/
      // external reload paths all come through here).
      drafts:
        s.activeDocId !== null ? { ...s.drafts, [s.activeDocId]: content } : s.drafts,
    })),
}));
