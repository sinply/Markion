/**
 * Display-title conversion layer: the app presents "documents" (Yuque-style)
 * while the storage layer stays plain `.md` files. Every UI surface that shows
 * a file name goes through these helpers so the `.md` extension never leaks
 * into the interface. Paths themselves are NEVER transformed — doc identity is
 * always the vault-relative path.
 */

/** Strip a trailing `.md` extension (case-insensitive, once).
 *  "notes/MyNote.md" -> basename "MyNote"; non-md names pass through. */
export function docTitle(nameOrPath: string): string {
  const base = nameOrPath.split("/").pop() ?? nameOrPath;
  return base.replace(/\.md$/i, "");
}

/** Title used when OPENING a document (tab label, recent lists). A folder's
 *  `index.md` — the folder-as-container body — displays as the FOLDER's name
 *  (Yuque-style knowledge-base entry) instead of a bare "index". */
export function titleForPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  if (/^index\.md$/i.test(base)) {
    const parts = path.split("/");
    const folder = parts[parts.length - 2];
    if (folder) return folder;
  }
  return docTitle(base);
}
