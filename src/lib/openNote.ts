import { readFile, fileSize } from "./ipc";
import { useDocStore } from "../stores/docStore";
import { useUiStore } from "../stores/uiStore";
import { getDict } from "./i18n";
import { titleForPath } from "./docTitle";

/** Files above this size trigger a confirmation before opening (design spec §7:
 *  "opening very large files warns before proceeding"). */
export const LARGE_FILE_BYTES = 5 * 1024 * 1024;

/** 1-based line number of the first ATX heading whose text equals `heading`
 *  (case-insensitive, `#` marks stripped), or null. Fenced code blocks are
 *  skipped so a `# foo` inside ``` never matches. */
export function findHeadingLine(content: string, heading: string): number | null {
  const want = heading.trim().toLowerCase();
  if (!want) return null;
  let inFence = false;
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (m && m[2].toLowerCase() === want) return i + 1;
  }
  return null;
}

/** Open a vault note in the editor tab: reads it, opens/activates the tab, and
 *  records it in the recent list. Shared by the file tree, graph, palette,
 *  wikilinks, and recent menu so they all behave identically.
 *  Returns false when the file can't be read (or the user declined a
 *  large-file warning). */
export async function openNote(
  vaultRoot: string,
  path: string,
  opts?: { addRecent?: boolean; heading?: string },
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
    const title = titleForPath(path);
    useDocStore.getState().openDoc(title, path);
    useDocStore.getState().setActiveContent(content);
    // Opening a document always leaves the library home.
    useUiStore.getState().setShowHome(false);
    if (opts?.addRecent !== false) {
      useUiStore.getState().addRecent(path);
    }
    // `[[note#heading]]`: scroll to the anchor line once the doc mounts.
    // Reuses the search-result jump mechanism (consumed in EditorPane).
    if (opts?.heading) {
      const line = findHeadingLine(content, opts.heading);
      if (line) useUiStore.getState().setPendingJump({ path, line, column: 1 });
    }
    return true;
  } catch {
    return false;
  }
}
