import { readFile, writeFileAtomic } from "./ipc";
import { extractFrontmatter, parseFrontmatter, replaceFrontmatter } from "./frontmatter";
import { useDocStore } from "../stores/docStore";
import { getEditorView } from "../editor/registry";

/** Apply one frontmatter key change to a document's full text. */
function applyKey(text: string, key: string, value: string): string {
  const fm = extractFrontmatter(text);
  const props: [string, string][] = fm ? parseFrontmatter(fm.body) : [];
  const idx = props.findIndex(([k]) => k === key);
  if (idx >= 0) props[idx] = [key, value];
  else props.push([key, value]);
  return replaceFrontmatter(text, props);
}

/** Update a single frontmatter key in the note at `path`, preserving the body.
 *  Shared by the .base database editor and the folder table view — both edit
 *  property cells that live in YAML frontmatter.
 *
 *  Single-writer rule: if the target doc is OPEN in this session we never
 *  write behind its back (its own autosave/flush owns the file). An active,
 *  mounted doc is patched through the live EditorView; any other open doc
 *  gets its draft updated so its next autosave/close-flush persists it. */
export async function writeFrontmatterKey(
  vaultRoot: string,
  path: string,
  key: string,
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ds = useDocStore.getState();
    const open = ds.openDocs.find((d) => d.path === path);
    if (open) {
      const view = getEditorView();
      if (view && ds.activeDocId === open.id) {
        // Active & mounted: patch through the live buffer. The normal
        // handleChange → autosave pipeline persists it.
        const text = view.state.doc.toString();
        const next = applyKey(text, key, value);
        view.dispatch({ changes: { from: 0, to: text.length, insert: next } });
        return { ok: true };
      }
      // Open but not mounted: update its DRAFT; the doc's own save path
      // writes it — direct disk writes here would race its autosave.
      let text = ds.drafts[open.id];
      if (text === undefined) {
        if (!ds.loadErrorMap[open.id]) text = await readFile(vaultRoot, path);
        else return { ok: false, error: "document failed to load" };
      }
      ds.setDraft(open.id, applyKey(text, key, value));
      ds.markDirty(open.id);
      return { ok: true };
    }
    const text = await readFile(vaultRoot, path);
    await writeFileAtomic(vaultRoot, path, applyKey(text, key, value));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
