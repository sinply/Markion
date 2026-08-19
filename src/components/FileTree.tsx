import { useCallback, useMemo, useState } from "react";
import { Tree } from "react-arborist";
import type { NodeRendererProps } from "react-arborist";
import { useVaultStore } from "../stores/vaultStore";
import { useDocStore } from "../stores/docStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import { createFile, createFolder, trashPath, readFile, renameWithLinks } from "../lib/ipc";
import { useI18n } from "../lib/i18n";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

interface RowData {
  id: string;
  name: string;
  children?: RowData[];
  kind: "file" | "folder";
}

/** A file is hidden (dotfile) if its basename starts with `.` (except `.markion`? no - all dotfiles hidden by default). */
function isDot(name: string): boolean {
  return name.startsWith(".");
}

function convertTree(
  node: { name: string; path: string; kind: "file" | "folder"; children: any[] },
  showHidden: boolean,
): RowData {
  return {
    id: node.path,
    name: node.name,
    kind: node.kind,
    children:
      node.kind === "folder"
        ? node.children
            .filter((c) => showHidden || !isDot(c.name))
            .map((c) => convertTree(c, showHidden))
        : undefined,
  };
}

/** Parent folder of a relative path ("" for top level). */
function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** Windows-invalid filename characters plus empty/dot names. */
const INVALID_NAME_RE = /[\\/:*?"<>|]/;

function validName(n: string): boolean {
  const t = n.trim();
  return t.length > 0 && !INVALID_NAME_RE.test(t) && t !== "." && t !== "..";
}

/** The node a context menu was opened on (null = vault-root empty area). */
interface MenuTarget {
  path: string;
  name: string;
  kind: "file" | "folder";
}

function NodeView({ node, style, dragHandle }: NodeRendererProps<RowData>) {
  const isFolder = node.data.kind === "folder";
  const hasIndex =
    isFolder &&
    !!node.data.children?.some((c) => c.name === "index.md" && c.kind === "file");
  return (
    <div
      style={{
        ...style,
        display: "flex",
        alignItems: "center",
        cursor: isFolder ? "default" : "pointer",
      }}
      ref={dragHandle}
      data-path={node.data.id}
      data-name={node.data.name}
      data-kind={node.data.kind}
      onDoubleClick={isFolder ? (e) => { e.stopPropagation(); node.toggle(); } : undefined}
      title={
        isFolder
          ? hasIndex
            ? "Click to open index.md · double-click to expand"
            : node.isOpen
              ? "Double-click to collapse"
              : "Double-click to expand"
          : node.data.name
      }
    >
      <span
        onClick={isFolder ? (e) => { e.stopPropagation(); node.toggle(); } : undefined}
        style={{
          marginRight: 2,
          fontSize: 10,
          width: 12,
          display: "inline-block",
          color: "#888",
          cursor: isFolder ? "pointer" : "default",
          userSelect: "none",
        }}
      >
        {isFolder ? (node.isOpen ? "▾" : "▸") : ""}
      </span>
      <span style={{ marginRight: 4, display: "inline-flex", flexShrink: 0 }}>
        {isFolder ? (
          node.isOpen ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#2ea043" fillOpacity="0.15" stroke="#2ea043" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#2ea043" fillOpacity="0.15" stroke="#2ea043" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <path d="M9 13l3 3 3-3" />
            </svg>
          )
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--fg-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        )}
      </span>
      <span
        style={{
          fontSize: 13,
          fontWeight: isFolder ? 600 : 400,
          color: isFolder ? "var(--fg)" : "var(--fg-muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {node.data.name}
      </span>
      {hasIndex && (
        <span
          style={{
            marginLeft: 6,
            fontSize: 9,
            color: "var(--fg-muted)",
            border: "1px solid var(--border)",
            borderRadius: 3,
            padding: "0 4px",
            opacity: 0.8,
          }}
        >
          index
        </span>
      )}
    </div>
  );
}

export function FileTree() {
  const tree = useVaultStore((s) => s.tree);
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const applyReorder = useVaultStore((s) => s.applyReorder);
  const applyMove = useVaultStore((s) => s.applyMove);
  const loadTree = useVaultStore((s) => s.loadTree);
  const openDoc = useDocStore((s) => s.openDoc);
  const setActiveContent = useDocStore((s) => s.setActiveContent);
  const closeDocsUnder = useDocStore((s) => s.closeDocsUnder);
  const renameDoc = useDocStore((s) => s.renameDoc);
  const showHidden = useSettingsStore((s) => s.showHiddenFiles);
  const t = useI18n();

  const [menu, setMenu] = useState<
    { x: number; y: number; target: MenuTarget | null } | null
  >(null);

  const handleActivate = useCallback(
    async (node: any) => {
      const d = node.data;
      if (!vaultRoot) return;
      // A folder with an index.md opens that file (folder-as-container body).
      if (d.kind === "folder") {
        const index = d.children?.find((c: any) => c.name === "index.md" && c.kind === "file");
        if (!index) return; // no index.md: keep default folder behavior
        const content = await readFile(vaultRoot, index.id);
        openDoc(index.name, index.id);
        setActiveContent(content);
        return;
      }
      if (d.kind !== "file") return;
      const content = await readFile(vaultRoot, d.id);
      openDoc(d.name, d.id);
      setActiveContent(content);
    },
    [vaultRoot, openDoc, setActiveContent],
  );

  const handleMove = useCallback(
    ({ dragIds, parentId, index, dragNodes }: any) => {
      const name = String(dragIds[0]);
      const srcParent = dragNodes?.[0]?.parent?.id ?? "";
      const destParent = parentId ?? "";
      if (srcParent !== destParent && destParent) {
        applyMove(srcParent, name, destParent, name);
      } else {
        applyReorder(destParent, name, index);
      }
    },
    [applyReorder, applyMove],
  );

  // Right-click on a tree row (or the empty area = vault root): remember the
  // node via data-* attributes (event delegation, no prop drilling into rows).
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const el = (e.target as HTMLElement).closest("[data-path]") as HTMLElement | null;
    if (!el) {
      setMenu({ x: e.clientX, y: e.clientY, target: null });
      return;
    }
    const kind = el.dataset.kind === "folder" ? "folder" : "file";
    setMenu({
      x: e.clientX,
      y: e.clientY,
      target: { path: el.dataset.path ?? "", name: el.dataset.name ?? "", kind },
    });
  }, []);

  // The folder new items are created inside: the target folder itself, or the
  // parent folder when the menu was opened on a file / the empty area.
  const containerFolder = (target: MenuTarget | null): string => {
    if (!target || target.kind === "folder") return target ? target.path : "";
    return parentOf(target.path);
  };

  const handleNewNote = useCallback(
    async (target: MenuTarget | null) => {
      if (!vaultRoot) return;
      const raw = window.prompt(t.ctxNewNamePrompt);
      if (raw === null) return;
      const trimmed = raw.trim();
      if (!validName(trimmed)) {
        window.alert(t.ctxInvalidName);
        return;
      }
      const fileName = /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
      const dir = containerFolder(target);
      const rel = dir ? `${dir}/${fileName}` : fileName;
      try {
        await createFile(vaultRoot, rel);
        await loadTree(vaultRoot);
        const content = await readFile(vaultRoot, rel);
        openDoc(fileName, rel);
        setActiveContent(content);
      } catch {
        // creation failed - tree/editor unchanged
      }
    },
    [vaultRoot, loadTree, openDoc, setActiveContent, t],
  );

  const handleNewFolder = useCallback(
    async (target: MenuTarget | null) => {
      if (!vaultRoot) return;
      const raw = window.prompt(t.ctxNewNamePrompt);
      if (raw === null) return;
      const trimmed = raw.trim();
      if (!validName(trimmed)) {
        window.alert(t.ctxInvalidName);
        return;
      }
      const dir = containerFolder(target);
      const rel = dir ? `${dir}/${trimmed}` : trimmed;
      try {
        await createFolder(vaultRoot, rel);
        await loadTree(vaultRoot);
      } catch {
        // creation failed - tree unchanged
      }
    },
    [vaultRoot, loadTree, t],
  );

  /** Create `index.md` inside a folder (folder-as-container body). */
  const handleCreateIndex = useCallback(
    async (target: MenuTarget) => {
      if (!vaultRoot || target.kind !== "folder") return;
      const rel = `${target.path}/index.md`;
      try {
        await createFile(vaultRoot, rel);
        await loadTree(vaultRoot);
        const content = await readFile(vaultRoot, rel);
        openDoc("index.md", rel);
        setActiveContent(content);
      } catch {
        // creation failed - tree/editor unchanged
      }
    },
    [vaultRoot, loadTree, openDoc, setActiveContent],
  );

  const handleRename = useCallback(
    async (target: MenuTarget) => {
      if (!vaultRoot) return;
      const { path, name, kind } = target;
      const raw = window.prompt(t.ctxRenamePrompt, name);
      if (raw === null) return;
      const trimmed = raw.trim();
      if (!validName(trimmed)) {
        window.alert(t.ctxInvalidName);
        return;
      }
      let newName = trimmed;
      // Keep the .md extension when renaming a file unless the user typed one.
      if (kind === "file" && /\.md$/i.test(name) && !/\.md$/i.test(trimmed)) {
        newName = `${trimmed}.md`;
      }
      const folder = parentOf(path);
      const newPath = folder ? `${folder}/${newName}` : newName;
      if (newPath === path) return;
      try {
        // Rename on disk AND rewrite every [[oldname]] reference in the vault
        // to the new name (Obsidian-style). Returns the number of files whose
        // links were updated.
        await renameWithLinks(vaultRoot, path, newPath);
        if (kind === "file") {
          renameDoc(path, newPath, newName);
        } else {
          // Folder rename: remap every open doc at/under the old folder path.
          const prefix = `${path}/`;
          for (const d of [...useDocStore.getState().openDocs]) {
            if (d.path === path || d.path.startsWith(prefix)) {
              const rel = newPath + d.path.slice(path.length);
              renameDoc(d.path, rel, rel.split("/").pop() ?? rel);
            }
          }
        }
        await loadTree(vaultRoot);
      } catch {
        // rename failed - tree/tabs unchanged
      }
    },
    [vaultRoot, renameDoc, loadTree, t],
  );

  const handleDelete = useCallback(
    async (target: MenuTarget) => {
      if (!vaultRoot) return;
      const { path, name, kind } = target;
      const msg =
        kind === "folder" ? t.ctxDeleteFolderPrompt(name) : t.ctxDeleteFilePrompt(name);
      if (!window.confirm(msg)) return;
      try {
        // Delete into the vault-internal trash (`.markion/trash`) so the
        // entry can be restored from the Trash dialog.
        await trashPath(vaultRoot, path);
        // Close tabs for the deleted node (and everything under it) before
        // the watcher event arrives, so no conflict dialog can appear.
        closeDocsUnder(path);
        await loadTree(vaultRoot);
      } catch {
        // delete failed - nothing removed
      }
    },
    [vaultRoot, closeDocsUnder, loadTree, t],
  );

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menu) return [];
    const items: ContextMenuItem[] = [{ id: "new-note", label: t.ctxNewNote }];
    const isFolderish = !menu.target || menu.target.kind === "folder";
    if (isFolderish) items.push({ id: "new-folder", label: t.ctxNewFolder });
    if (menu.target) {
      // Folder-as-container: create (or open) the folder's index.md body.
      if (menu.target.kind === "folder") {
        items.push({ id: "new-index", label: t.ctxNewIndex });
      }
      items.push({ id: "rename", label: t.ctxRename });
      items.push({ id: "delete", label: t.ctxDelete, danger: true });
    }
    items.push({ id: "trash", label: t.ctxTrash });
    return items;
  }, [menu, t]);

  const handleMenuPick = useCallback(
    (id: string) => {
      const target = menu?.target ?? null;
      setMenu(null);
      if (id === "new-note") void handleNewNote(target);
      else if (id === "new-folder") void handleNewFolder(target);
      else if (id === "new-index" && target) void handleCreateIndex(target);
      else if (id === "rename" && target) void handleRename(target);
      else if (id === "delete" && target) void handleDelete(target);
      else if (id === "trash") useUiStore.getState().setTrashOpen(true);
    },
    [menu, handleNewNote, handleNewFolder, handleCreateIndex, handleRename, handleDelete],
  );

  // Default: all folders collapsed, showing only the top level
  const initialOpenState = useMemo(() => {
    const map: Record<string, boolean> = {};
    if (tree) {
      const visit = (children: { name: string; path: string; kind: string; children: any[] }[]) => {
        for (const c of children) {
          if (c.kind === "folder") {
            map[c.path] = false; // collapsed by default
            visit(c.children);
          }
        }
      };
      visit(tree.children);
    }
    return map;
  }, [tree]);

  if (!tree) {
    return <div style={{ padding: 8, color: "var(--fg-muted)", fontSize: 13 }}>No vault open</div>;
  }

  const rowData: RowData[] = tree.children
    .filter((c) => showHidden || !isDot(c.name))
    .map((c) => convertTree(c, showHidden));

  return (
    <>
      <div
        style={{ height: "100%", overflow: "auto" }}
        onContextMenu={handleContextMenu}
      >
        <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", fontSize: 12, color: "var(--fg-muted)" }}>
          {tree.name || "Vault"}
        </div>
        <Tree<RowData>
          data={rowData}
          width="100%"
          height={window.innerHeight - 40}
          rowHeight={28}
          initialOpenState={initialOpenState}
          onMove={handleMove}
          onActivate={handleActivate}
        >
          {NodeView}
        </Tree>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onPick={handleMenuPick}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
