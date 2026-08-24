import { invoke } from "@tauri-apps/api/core";
import type { TreeNode, Settings } from "./types";

export async function readFile(vaultRoot: string, path: string): Promise<string> {
  return invoke<string>("read_file", { vaultRoot, path });
}

export async function writeFileAtomic(
  vaultRoot: string, path: string, content: string,
): Promise<void> {
  await invoke<void>("write_file_atomic", { vaultRoot, path, content });
}

export async function buildTree(vaultRoot: string): Promise<TreeNode> {
  return invoke<TreeNode>("build_tree", { vaultRoot });
}

export async function reorderInFolder(
  vaultRoot: string, folderRel: string, name: string, newIndex: number,
): Promise<void> {
  await invoke<void>("reorder_in_folder", { vaultRoot, folderRel, name, newIndex });
}

export async function setCollapsed(
  vaultRoot: string, folderRel: string, collapsed: boolean,
): Promise<void> {
  await invoke<void>("set_collapsed", { vaultRoot, folderRel, collapsed });
}

export async function moveNode(
  vaultRoot: string, fromFolder: string, fromName: string,
  toFolder: string, toName: string,
): Promise<void> {
  await invoke<void>("move_node", { vaultRoot, fromFolder, fromName, toFolder, toName });
}

export async function createFile(vaultRoot: string, path: string): Promise<void> {
  await invoke<void>("create_file", { vaultRoot, path });
}

export async function createFolder(vaultRoot: string, path: string): Promise<void> {
  await invoke<void>("create_folder", { vaultRoot, path });
}

/** Move a file or folder to the OS trash/recycle bin. */
export async function deletePath(vaultRoot: string, path: string): Promise<void> {
  await invoke<void>("delete_path", { vaultRoot, path });
}

/** Move a file/folder into the vault-internal trash (.markion/trash),
 *  preserving its relative path so it can be restored. */
export async function trashPath(vaultRoot: string, path: string): Promise<void> {
  await invoke<void>("trash_path", { vaultRoot, path });
}

export interface TrashEntry {
  path: string;
  name: string;
  kind: string;
  modified: number;
}

/** List the vault-internal trash, newest first. */
export async function listTrash(vaultRoot: string): Promise<TrashEntry[]> {
  return invoke<TrashEntry[]>("list_trash", { vaultRoot });
}

/** Restore a trashed entry (path from listTrash) to its original location. */
export async function restoreTrash(vaultRoot: string, relPath: string): Promise<void> {
  await invoke<void>("restore_trash", { vaultRoot, relPath });
}

/** Rename/move a file or folder and rewrite every `[[oldstem]]` reference in
 *  the vault. Returns the number of files whose content was rewritten. */
export async function renameWithLinks(
  vaultRoot: string,
  oldPath: string,
  newPath: string,
): Promise<number> {
  return invoke<number>("rename_with_links", { vaultRoot, oldPath, newPath });
}

export async function saveImage(
  vaultRoot: string, bytes: Uint8Array, ext: string, docRel: string,
  strategy: string, pathStyle: string, date: string,
): Promise<string> {
  return invoke<string>("save_image", {
    vaultRoot, bytes: Array.from(bytes), ext, docRel, strategy, pathStyle, date,
  });
}

export interface Backlink {
  path: string;
  title: string;
}

export interface GraphNode {
  id: string;
  title: string;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export async function findBacklinks(vaultRoot: string, target: string): Promise<Backlink[]> {
  return invoke<Backlink[]>("find_backlinks", { vaultRoot, target });
}

export async function scanGraph(vaultRoot: string): Promise<[GraphNode[], GraphEdge[]]> {
  return invoke<[GraphNode[], GraphEdge[]]>("scan_graph", { vaultRoot });
}

export interface SearchHit {
  path: string;
  title: string;
  line: number;
  column: number;
  snippet: string;
}

/** Full-text search over all `.md` files in the vault. */
export async function searchVault(
  vaultRoot: string,
  query: string,
  opts?: { caseSensitive?: boolean; useRegex?: boolean; maxHits?: number },
): Promise<SearchHit[]> {
  return invoke<SearchHit[]>("search_vault", {
    vaultRoot,
    query,
    caseSensitive: opts?.caseSensitive ?? false,
    useRegex: opts?.useRegex ?? false,
    maxHits: opts?.maxHits ?? 500,
  });
}

export interface ReplaceResult {
  filesChanged: number;
  replacements: number;
}

/** Replace across all `.md` files in the vault; returns change counts. */
export async function replaceInVault(
  vaultRoot: string,
  query: string,
  replacement: string,
  opts?: { caseSensitive?: boolean; useRegex?: boolean },
): Promise<ReplaceResult> {
  return invoke<ReplaceResult>("replace_in_vault", {
    vaultRoot,
    query,
    replacement,
    caseSensitive: opts?.caseSensitive ?? false,
    useRegex: opts?.useRegex ?? false,
  });
}

export interface TagEntry {
  tag: string;
  path: string;
  title: string;
}

/** Scan the vault for `#tag` occurrences. */
export async function scanTags(vaultRoot: string): Promise<TagEntry[]> {
  return invoke<TagEntry[]>("scan_tags", { vaultRoot });
}

export async function readConfig(vaultRoot: string): Promise<Settings> {
  return invoke<Settings>("read_config", { vaultRoot });
}

export async function saveConfig(vaultRoot: string, settings: Settings): Promise<void> {
  await invoke<void>("save_config", { vaultRoot, settings });
}

export async function startVaultWatch(vaultRoot: string): Promise<void> {
  await invoke<void>("start_vault_watch", { vaultRoot });
}

/** Write `content` to an arbitrary absolute path (export flow). */
export async function exportFile(path: string, content: string): Promise<void> {
  await invoke<void>("export_file", { path, content });
}

/** Read an absolute path and return its base64 contents (export image inlining). */
export async function readFileBase64(path: string): Promise<string> {
  return invoke<string>("read_file_base64", { path });
}

/** Write base64-encoded binary content to an absolute path (PDF/image export). */
export async function writeFileBase64(path: string, base64Data: string): Promise<void> {
  await invoke<void>("write_file_base64", { path, base64Data });
}

/** Size in bytes of a vault-relative file. */
export async function fileSize(vaultRoot: string, path: string): Promise<number> {
  return invoke<number>("file_size", { vaultRoot, path });
}

// --- Document projection (read-model over the .md files) --------------------

export interface LibraryEntry {
  path: string;
  title: string;
  mtimeSecs: number;
  wordCount: number;
  summary: string;
  tags: string[];
}

/** Document cards for the library home, newest first; `folder` scopes to a
 *  folder subtree (null/undefined = whole vault). */
export async function queryLibrary(
  vaultRoot: string,
  folder?: string | null,
): Promise<LibraryEntry[]> {
  return invoke<LibraryEntry[]>("query_library", { vaultRoot, folder: folder ?? null });
}

export interface TableColumn {
  name: string;
  /** "text" | "number" | "date" | "tags" */
  type: string;
}

export interface FolderTableRow {
  path: string;
  name: string;
  values: Record<string, string>;
}

export interface FolderTable {
  columns: TableColumn[];
  rows: FolderTableRow[];
}

/** Folder table view: direct `.md` children as rows, frontmatter keys as
 *  auto-inferred columns (the Yuque-style folder-as-database mapping). */
export async function queryFolderTable(vaultRoot: string, folder: string): Promise<FolderTable> {
  return invoke<FolderTable>("query_folder_table", { vaultRoot, folder });
}
