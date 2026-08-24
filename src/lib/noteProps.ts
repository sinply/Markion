import { readFile, writeFileAtomic } from "./ipc";
import { extractFrontmatter, parseFrontmatter, replaceFrontmatter } from "./frontmatter";

/** Update a single frontmatter key in the note at `path`, preserving the body.
 *  Shared by the .base database editor and the folder table view — both edit
 *  property cells that live in YAML frontmatter. */
export async function writeFrontmatterKey(
  vaultRoot: string,
  path: string,
  key: string,
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const text = await readFile(vaultRoot, path);
    const fm = extractFrontmatter(text);
    const props: [string, string][] = fm ? parseFrontmatter(fm.body) : [];
    const idx = props.findIndex(([k]) => k === key);
    if (idx >= 0) props[idx] = [key, value];
    else props.push([key, value]);
    const next = replaceFrontmatter(text, props);
    await writeFileAtomic(vaultRoot, path, next);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
