import { readFile } from "./ipc";
import { useDocStore } from "../stores/docStore";
import { useUiStore } from "../stores/uiStore";

/** Open a vault note in the editor tab: reads it, opens/activates the tab, and
 *  records it in the recent list. Shared by the file tree, graph, palette,
 *  wikilinks, and recent menu so they all behave identically.
 *  Returns false when the file can't be read. */
export async function openNote(
  vaultRoot: string,
  path: string,
  opts?: { addRecent?: boolean },
): Promise<boolean> {
  try {
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
