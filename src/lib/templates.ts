import { buildTree, createFile, readFile, writeFileAtomic } from "./ipc";
import { useSettingsStore } from "../stores/settingsStore";
import { openNote } from "./openNote";

export interface TemplateFile {
  name: string;
  path: string;
}

/** Find `.md` files under the template folder (any depth). */
export async function listTemplates(
  vaultRoot: string,
  templateFolder: string,
): Promise<TemplateFile[]> {
  if (!templateFolder) return [];
  try {
    const root = await buildTree(vaultRoot);
    const folder = findNode(root, templateFolder);
    if (!folder || folder.kind !== "folder") return [];
    const out: TemplateFile[] = [];
    collectMd(folder, out);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** Look up a template by name (case-insensitive, `.md` optional). */
export async function findTemplate(
  vaultRoot: string,
  templateFolder: string,
  names: string[],
): Promise<TemplateFile | null> {
  const templates = await listTemplates(vaultRoot, templateFolder);
  const wanted = new Set(names.map((n) => n.replace(/\.md$/i, "").toLowerCase()));
  return (
    templates.find((t) => wanted.has(t.name.replace(/\.md$/i, "").toLowerCase())) ?? null
  );
}

/** Open today's note (`YYYY-MM-DD.md`), creating it if missing. When a
 *  template named "Daily" exists in the template folder, a brand-new note is
 *  initialized with it. */
export async function openDailyNote(vaultRoot: string): Promise<void> {
  const today = localDateStamp();
  const path = `${today}.md`;
  try {
    await createFile(vaultRoot, path);
  } catch {
    // already exists or creation failed — proceed
  }
  const templateFolder = useSettingsStore.getState().templateFolder;
  if (templateFolder) {
    try {
      const daily = await findTemplate(vaultRoot, templateFolder, ["Daily", "daily"]);
      const existing = await readFile(vaultRoot, path);
      if (daily && existing === "") {
        const content = await readFile(vaultRoot, daily.path);
        if (content) await writeFileAtomic(vaultRoot, path, content);
      }
    } catch {
      // template init failed — the empty note still opens
    }
  }
  await openNote(vaultRoot, path);
}

/** Local date as YYYY-MM-DD (not UTC). */
export function localDateStamp(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function findNode(
  node: { name: string; path: string; kind: "file" | "folder"; children: any[] },
  path: string,
): { name: string; path: string; kind: "file" | "folder"; children: any[] } | null {
  if (node.path === path) return node;
  for (const c of node.children) {
    const hit = findNode(c, path);
    if (hit) return hit;
  }
  return null;
}

function collectMd(
  node: { name: string; path: string; kind: "file" | "folder"; children: any[] },
  out: TemplateFile[],
): void {
  if (node.kind === "file") {
    if (/\.md$/i.test(node.name)) out.push({ name: node.name, path: node.path });
    return;
  }
  for (const c of node.children) collectMd(c, out);
}
