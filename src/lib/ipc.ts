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

export async function readConfig(vaultRoot: string): Promise<Settings> {
  return invoke<Settings>("read_config", { vaultRoot });
}

export async function saveConfig(vaultRoot: string, settings: Settings): Promise<void> {
  await invoke<void>("save_config", { vaultRoot, settings });
}

export async function startVaultWatch(vaultRoot: string): Promise<void> {
  await invoke<void>("start_vault_watch", { vaultRoot });
}
