import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useVaultStore } from "../stores/vaultStore";
import { useDocStore } from "../stores/docStore";
import { useUiStore } from "../stores/uiStore";
import { getEditorView } from "../editor/registry";
import { readFile } from "../lib/ipc";

/** Paths that the app itself renamed/trashed a moment ago. The watcher emits a
 *  "deleted" event for the OLD path after an in-app rename, and that event can
 *  beat the store's renameDoc remap — without this, useExternalChanges would
 *  misread the active doc as externally deleted and close it / pop the Save-As
 *  dialog. FileTree records the old path here right after a successful rename
 *  or trash; the handler ignores matching deletes for a short window. */
export const recentAppChanges = new Map<string, number>();
export function markAppChange(path: string): void {
  recentAppChanges.set(path, Date.now());
}
const IGNORE_WINDOW_MS = 3000;

/** Pure decision for how to react to a disk change of the active doc. Exported
 *  for tests. */
export function decideExternalChange(opts: {
  lastSaved: string | undefined;
  editor: string | undefined;
  disk: string;
  dirty: boolean;
}): "ignore-echo" | "ignore-same" | "conflict" | "reload" {
  if (opts.lastSaved !== undefined && opts.disk === opts.lastSaved) return "ignore-echo";
  if (opts.editor !== undefined && opts.editor === opts.disk) return "ignore-same";
  return opts.dirty ? "conflict" : "reload";
}

/** Pure decision for a deleted active doc: dirty editors get the Save As…
 *  dialog, clean ones just close (their content already matched disk). */
export function decideDeleted(dirty: boolean, hasEditor: boolean): "dialog" | "close" | "ignore" {
  if (dirty && hasEditor) return "dialog";
  if (!dirty) return "close";
  return "ignore";
}

/**
 * Listen for the backend `vault-changed` event (emitted by the file watcher)
 * and react:
 *  - always rebuild the document tree (new/deleted/renamed files)
 *  - if the active document changed on disk, reload it when clean, or surface a
 *    "keep mine / load disk" conflict when it has unsaved edits
 */
export function useExternalChanges() {
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const loadTree = useVaultStore((s) => s.loadTree);

  useEffect(() => {
    if (!vaultRoot) return;
    let unlisten: (() => void) | undefined;
    let dead = false;

    const setup = async () => {
      const un = await listen<string[]>("vault-changed", async (event) => {
        // The vault may have been switched while this listener was still being
        // registered. The `dead` flag only prevents a LATE registration — an
        // already-registered handler can still receive an event for the old
        // vault, and loadTree(oldRoot) would flip the whole app back to it.
        if (useVaultStore.getState().vaultRoot !== vaultRoot) return;
        const paths = event.payload ?? [];

        // 1. refresh the tree for any structural change
        await loadTree(vaultRoot).catch(() => {});

        // 2. handle a change to the active document. Re-read the store AFTER
        // every await: the user may have typed or switched tabs while the tree
        // reloaded, and acting on the pre-await snapshot used to discard those
        // keystrokes — or insert doc A's disk text into doc B's buffer.
        const activeNow = () => {
          const s = useDocStore.getState();
          return s.openDocs.find((d) => d.id === s.activeDocId);
        };
        const active = activeNow();
        if (!active || !paths.includes(active.path)) return;

        let disk: string;
        try {
          disk = await readFile(vaultRoot, active.path);
        } catch {
          if (activeNow()?.id !== active.id) return; // switched away meanwhile
          // The active file was deleted (or is unreadable) on disk.
          // The app itself may have renamed/trashed this path a moment ago
          // (its watcher event beat the store remap) — that is not an external
          // deletion, so do not close the tab or offer Save As.
          const since = recentAppChanges.get(active.path);
          if (since !== undefined && Date.now() - since < IGNORE_WINDOW_MS) {
            recentAppChanges.delete(active.path);
            return;
          }
          // Only trust the mounted editor when it still belongs to this doc:
          // after openDoc/switchTo the view can still hold ANOTHER document's
          // text until EditorPane remounts, and that text would be offered as
          // this doc's unsaved content in the Save As… dialog.
          const s0 = useDocStore.getState();
          const editor =
            s0.activeDocId === active.id ? getEditorView()?.state.doc.toString() : undefined;
          const dirty = !!s0.dirtyMap[active.id];
          const decision = decideDeleted(dirty, editor !== undefined);
          if (decision === "dialog" && editor !== undefined) {
            // Unsaved edits: offer Save As… / discard.
            useUiStore.getState().setDeletedDoc({
              path: active.path,
              title: active.title,
              content: editor,
            });
          } else if (decision === "close") {
            // Clean: the tab's content matches what was on disk — just close it.
            useDocStore.getState().closeDoc(active.id);
          }
          return;
        }

        // The read took time: only act if this doc is still the active one.
        if (activeNow()?.id !== active.id) return;

        const st = useDocStore.getState();
        const lastSaved = st.savedContent[active.id];
        // Only trust the mounted editor when it still belongs to this doc.
        const editor =
          st.activeDocId === active.id ? getEditorView()?.state.doc.toString() : undefined;
        const decision = decideExternalChange({
          lastSaved,
          editor,
          disk,
          dirty: !!st.dirtyMap[active.id],
        });

        if (decision === "ignore-echo" || decision === "ignore-same") return;

        if (decision === "conflict") {
          useUiStore.getState().setConflict({ path: active.path, diskContent: disk });
        } else {
          // Clean: reload the mounted editor directly (setActiveContent alone
          // does not refresh a mounted CM6 view) and sync the store. The
          // dispatch fires onChange, which would mark the doc dirty and arm an
          // autosave of the very content we just loaded — clear that: the
          // editor now matches disk.
          if (useDocStore.getState().activeDocId === active.id) {
            const view = getEditorView();
            if (view) {
              view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: disk } });
            }
          }
          const s = useDocStore.getState();
          s.markClean(active.id);
          s.markSaved(active.id, disk);
          s.setActiveContent(disk);
        }
      });
      // The vault may have been switched (or the app unmounted) while the
      // listen() promise was in flight — never leak a listener onto the new
      // vault's effect instance.
      if (dead) un();
      else unlisten = un;
    };
    void setup();

    return () => {
      dead = true;
      if (unlisten) unlisten();
    };
  }, [vaultRoot, loadTree]);
}
