import { writeFileAtomic } from "./ipc";
import { useDocStore } from "../stores/docStore";
import { useVaultStore } from "../stores/vaultStore";
import { useUiStore } from "../stores/uiStore";

/**
 * Single-writer helpers: every path that discards or replaces a doc's editor
 * state (closing a tab, deleting a folder, switching vaults, quitting the
 * app) must flush pending edits FIRST, otherwise the 1s-debounced autosave
 * loses them (its timer finds no doc after closeDoc/reset and gives up).
 */

/** True while an external-change conflict dialog is open for `path`. */
function conflictOpenFor(path: string | undefined): boolean {
  if (!path) return false;
  const conflict = useUiStore.getState().conflict;
  return !!conflict && conflict.path === path;
}

/**
 * Persist a dirty doc's latest known content (its draft) to disk and mark it
 * clean. Returns false when nothing needed writing, the write failed, or an
 * external-change conflict for this file is open (the user is deciding).
 */
export async function flushDoc(id: string): Promise<boolean> {
  const st = useDocStore.getState();
  if (!st.dirtyMap[id]) return true; // clean — nothing to do
  const content = st.drafts[id];
  const root = useVaultStore.getState().vaultRoot;
  const path = st.openDocs.find((d) => d.id === id)?.path;
  // No draft / no vault / load previously failed: refuse to guess content.
  if (content === undefined || !root || !path) return false;
  if (conflictOpenFor(path)) return false;
  try {
    await writeFileAtomic(root, path, content);
    // Only report saved when nothing newer was typed during the write.
    const after = useDocStore.getState();
    if ((after.drafts[id] ?? content) === content) {
      after.markSaved(id, content);
      after.markClean(id);
    }
    return true;
  } catch {
    return false;
  }
}

/** Flush every open dirty doc (sequential: deterministic disk ordering). */
export async function flushAllDirty(): Promise<void> {
  const ids = Object.entries(useDocStore.getState().dirtyMap)
    .filter(([, dirty]) => dirty)
    .map(([id]) => id);
  for (const id of ids) {
    await flushDoc(id);
  }
}

/** Flush every open dirty doc that lives under `path` (inclusive). Used
 *  before trashing/deleting a folder so its trash copy holds the newest
 *  content, not stale disk text. */
export async function flushDocsUnder(path: string): Promise<void> {
  const prefix = path.endsWith("/") ? path : path + "/";
  const ids = Object.entries(useDocStore.getState().dirtyMap)
    .filter(([id, dirty]) => dirty && (id === path || id.startsWith(prefix)))
    .map(([id]) => id);
  for (const id of ids) {
    await flushDoc(id);
  }
}
