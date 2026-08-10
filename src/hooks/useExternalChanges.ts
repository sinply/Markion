import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useVaultStore } from "../stores/vaultStore";
import { useDocStore } from "../stores/docStore";
import { readFile } from "../lib/ipc";

/**
 * Listen for the backend `vault-changed` event (emitted by the file watcher)
 * and react:
 *  - always rebuild the document tree (new/deleted/renamed files)
 *  - if the active document's path is in the changed set and the doc is clean,
 *    reload its content from disk silently; if dirty, leave it (user's edits win)
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

        // 2. reload the active doc if it was changed externally and is clean
        const { activeDocId, openDocs, dirtyMap, setActiveContent } =
          useDocStore.getState();
        if (!activeDocId) return;
        const active = openDocs.find((d) => d.id === activeDocId);
        if (!active) return;
        if (dirtyMap[activeDocId]) return; // user has unsaved edits - keep them
        if (!paths.includes(active.path)) return;
        try {
          const content = await readFile(vaultRoot, active.path);
          setActiveContent(content);
        } catch {
          // file may have been deleted - leave the editor as is
        }
      });
    };
    setup();

    return () => {
      if (unlisten) unlisten();
    };
  }, [vaultRoot, loadTree]);
}
