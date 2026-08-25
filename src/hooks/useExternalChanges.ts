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

    const setup = async () => {
      unlisten = await listen<string[]>("vault-changed", async (event) => {
        const paths = event.payload ?? [];

        // 1. refresh the tree for any structural change
        await loadTree(vaultRoot).catch(() => {});

        // 2. handle a change to the active document
        const docStore = useDocStore.getState();
        const active = docStore.openDocs.find((d) => d.id === docStore.activeDocId);
        if (!active || !paths.includes(active.path)) return;

        let disk: string;
        try {
          disk = await readFile(vaultRoot, active.path);
        } catch {
          // The active file was deleted (or is unreadable) on disk.
          // The app itself may have renamed/trashed this path a moment ago
          // (its watcher event beat the store remap) — that is not an external
          // deletion, so do not close the tab or offer Save As.
          const since = recentAppChanges.get(active.path);
          if (since !== undefined && Date.now() - since < IGNORE_WINDOW_MS) {
            recentAppChanges.delete(active.path);
            return;
          }
          const view = getEditorView();
          const editor = view?.state.doc.toString();
          const dirty = !!useDocStore.getState().dirtyMap[active.id];
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

        const lastSaved = docStore.savedContent[active.id];
        const editor = getEditorView()?.state.doc.toString();
        const decision = decideExternalChange({
          lastSaved,
          editor,
          disk,
          dirty: !!docStore.dirtyMap[active.id],
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
          const view = getEditorView();
          if (view) {
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: disk } });
          }
          docStore.markClean(active.id);
          docStore.markSaved(active.id, disk);
          docStore.setActiveContent(disk);
        }
      });
    };
    setup();

    return () => {
      if (unlisten) unlisten();
    };
  }, [vaultRoot, loadTree]);
}
