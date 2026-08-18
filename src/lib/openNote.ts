import { readFile, fileSize } from "./ipc";
import { useDocStore } from "../stores/docStore";
import { useUiStore } from "../stores/uiStore";
import { getDict } from "./i18n";

/** Files above this size trigger a confirmation before opening (design spec §7:
 *  "opening very large files warns before proceeding"). */
export const LARGE_FILE_BYTES = 5 * 1024 * 1024;

/** Open a vault note in the editor tab: reads it, opens/activates the tab, and
 *  records it in the recent list. Shared by the file tree, graph, palette,
 *  wikilinks, and recent menu so they all behave identically.
 *  Returns false when the file can't be read (or the user declined a
 *  large-file warning). */
export async function openNote(
  vaultRoot: string,
  path: string,
  opts?: { addRecent?: boolean },
): Promise<boolean> {
  try {
    // Warn before opening very large files.
    try {
      const size = await fileSize(vaultRoot, path);
      if (size > LARGE_FILE_BYTES) {
        const t = getDict();
        const mb = (size / (1024 * 1024)).toFixed(1);
        if (!window.confirm(t.largeFileWarning.replace("{sizeMB}", mb))) {
          return false;
        }
      }
    } catch {
      // size check failed — proceed with the open anyway
    }
    const content = await readFile(vaultRoot, path);
    const title = path.split("/").pop() ?? path;
    useDocStore.getState().openDoc(title, path);
    useDocStore.getState().setActiveContent(content);
    if (opts?.addRecent !== false) {
      useUiStore.getState().addRecent(path);
    }
    return true;
  } catch {
    return false;
  }
}
