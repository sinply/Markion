import { useCallback, useEffect, useMemo, useState } from "react";
import { useUiStore } from "../stores/uiStore";
import { useVaultStore } from "../stores/vaultStore";
import { useI18n } from "../lib/i18n";
import { buildTree, readFile } from "../lib/ipc";
import { openNote } from "../lib/openNote";
import { extractFrontmatter, parseFrontmatter } from "../lib/frontmatter";
import {
  parseBaseFile,
  sortAndFilterRows,
  nextSortDir,
  dedupeRows,
  DEFAULT_SORT,
  type BaseDefinition,
  type BaseRow,
  type SortState,
} from "../lib/base";
import { writeFrontmatterKey } from "../lib/noteProps";
import { TableView } from "./BaseTable";

type Dict = ReturnType<typeof useI18n>;

/** Recursively collect every `*.base` file path from the cached vault tree. */
function collectBaseFiles(
  node: { name: string; path: string; kind: string; children: any[] } | null,
): { name: string; path: string }[] {
  if (!node) return [];
  const out: { name: string; path: string }[] = [];
  const walk = (n: typeof node) => {
    if (n.kind === "file") {
      if (n.name.toLowerCase().endsWith(".base")) {
        out.push({ name: n.name, path: n.path });
      }
      return;
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(node);
  return out;
}

/** Walk the tree and collect `.md` rows directly inside the configured folder
 *  (which may be nested anywhere under the vault root). Rows are the folder's
 *  immediate .md files; subfolders are not descended into (Obsidian Base). */
function collectRows(
  node: { name: string; path: string; kind: string; children: any[] },
  target: string,
  rows: BaseRow[],
) {
  // Descend to the target folder first: `target` is vault-root-relative
  // (e.g. "notes/inbox"), and the cached tree mirrors that structure. If the
  // target is the vault root (""), collect from the root level directly.
  const targetNode = target === "" ? node : findNode(node, target);
  if (!targetNode || targetNode.kind !== "folder") return;
  for (const c of targetNode.children ?? []) {
    if (c.kind !== "file" || !c.name.toLowerCase().endsWith(".md")) continue;
    rows.push({
      path: c.path,
      name: c.name.replace(/\.md$/i, ""),
      values: {},
    });
  }
}

/** Find a folder node by exact vault-relative path in a cached tree. */
function findNode(
  node: { name: string; path: string; kind: string; children: any[] } | null,
  path: string,
): { name: string; path: string; kind: string; children: any[] } | null {
  if (!node) return null;
  if (node.path === path) return node;
  for (const c of node.children ?? []) {
    const hit = findNode(c, path);
    if (hit) return hit;
  }
  return null;
}

/** Parent folder of a vault-relative path ("" for top level). */
function parentOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

/** Read the `.base` file and turn each `.md` in the folder into a row. The
 *  loader is async; the dialog keeps an `error` string when it fails so the
 *  user sees a single inline message instead of silent empty rows. */
async function loadRowsFromBase(
  vaultRoot: string,
  def: BaseDefinition,
): Promise<{ rows: BaseRow[]; error: string }> {
  try {
    const tree = await buildTree(vaultRoot);
    const rows: BaseRow[] = [];
    collectRows(tree, def.folder, rows);
    // Now read each file's frontmatter via IPC and fill values.
    for (const r of rows) {
      try {
        const text = await readFile(vaultRoot, r.path);
        const fm = extractFrontmatter(text);
        if (!fm) continue;
        const props = parseFrontmatter(fm.body);
        for (const f of def.fields) {
          const hit = props.find(([k]) => k === f.name);
          if (hit) r.values[f.name] = hit[1];
        }
      } catch {
        // unreadable file: leave values empty
      }
    }
    return { rows: dedupeRows(rows), error: "" };
  } catch (e) {
    return { rows: [], error: String(e) };
  }
}

/** Modal overlay that hosts either the .base picker or the table view. */
export function BaseDialog() {
  const open = useUiStore((s) => s.baseOpen);
  const setOpen = useUiStore((s) => s.setBaseOpen);
  const baseFile = useUiStore((s) => s.baseFile);
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const tree = useVaultStore((s) => s.tree);
  const t = useI18n();

  // ----- picker state -----------------------------------------------------
  const allBases = useMemo(() => collectBaseFiles(tree), [tree]);

  // ----- table state ------------------------------------------------------
  const [def, setDef] = useState<BaseDefinition | null>(null);
  const [rows, setRows] = useState<BaseRow[]>([]);
  const [err, setErr] = useState("");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ row: string; field: string } | null>(null);

  /** Load the .base definition and resolve rows whenever the dialog opens on a
   *  different file (or the vault root changes). */
  useEffect(() => {
    if (!open || !baseFile || !vaultRoot) {
      setDef(null);
      setRows([]);
      setErr("");
      setEditing(null);
      setFilters({});
      setSort(DEFAULT_SORT);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const text = await readFile(vaultRoot, baseFile);
        if (cancelled) return;
        const parsed = parseBaseFile(text);
        setDef(parsed);
        const out = await loadRowsFromBase(vaultRoot, parsed);
        if (cancelled) return;
        setRows(out.rows);
        setErr(out.error);
        setEditing(null);
        setFilters({});
        setSort(DEFAULT_SORT);
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, baseFile, vaultRoot]);

  const view = useMemo(() => sortAndFilterRows(rows, sort, filters), [rows, sort, filters]);

  const pickFile = useCallback(
    (path: string) => {
      setOpen(true, path);
    },
    [setOpen],
  );

  const openRow = useCallback(
    (path: string) => {
      if (!vaultRoot) return;
      // Close the database and open the note. openNote handles the tab /
      // recent list / large-file warning.
      void openNote(vaultRoot, path);
    },
    [vaultRoot],
  );

  if (!open) return null;

  const title =
    baseFile && def ? `${baseFile.split("/").pop()} · ${def.folder || "/"}` : t.basePickerTitle;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1001,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false, null);
      }}
    >
      <div
        style={{
          width: "min(960px, 92vw)",
          maxHeight: "82vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--panel-bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            borderBottom: "1px solid var(--border)",
          }}
        >
          {baseFile && (
            <button
              onClick={() => setOpen(true, null)}
              title={t.baseBack}
              style={{
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 4,
                color: "var(--fg)",
                padding: "3px 8px",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              ←
            </button>
          )}
          <div style={{ fontWeight: 600, fontSize: 14, color: "var(--fg)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}
          </div>
          <button
            onClick={() => setOpen(false, null)}
            title={t.close}
            style={{
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--fg)",
              padding: "3px 10px",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {t.close}
          </button>
        </div>

        {!baseFile || !def ? (
          <PickerList
            bases={allBases}
            t={t}
            onPick={pickFile}
          />
        ) : (
          <TableView
            fields={def.fields}
            rows={view}
            err={err}
            sort={sort}
            filters={filters}
            editing={editing}
            t={t}
            onHeaderClick={(field) => {
              setSort((s) =>
                s.field === field
                  ? { field, dir: nextSortDir(s.dir) }
                  : { field, dir: "asc" },
              );
            }}
            onFilterChange={(field, value) =>
              setFilters((f) => ({ ...f, [field]: value }))
            }
            onCellStartEdit={(row, field) => setEditing({ row, field })}
            onCellCommit={async (rowPath, field, value) => {
              setEditing(null);
              if (!vaultRoot) return;
              const result = await writeFrontmatterKey(vaultRoot, rowPath, field, value);
              if (!result.ok) {
                setErr(result.error);
                return;
              }
              // Patch the local row so the table reflects the edit immediately.
              setRows((rs) =>
                rs.map((r) =>
                  r.path === rowPath
                    ? { ...r, values: { ...r.values, [field]: value } }
                    : r,
                ),
              );
              setErr("");
            }}
            onCellCancel={() => setEditing(null)}
            onRowOpen={openRow}
          />
        )}
      </div>
    </div>
  );
}

function PickerList({
  bases,
  t,
  onPick,
}: {
  bases: { name: string; path: string }[];
  t: Dict;
  onPick: (path: string) => void;
}) {
  if (bases.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          color: "var(--fg-muted)",
          fontSize: 13,
          textAlign: "center",
        }}
      >
        {t.basePickerEmpty}
      </div>
    );
  }
  return (
    <div
      style={{
        padding: 8,
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {bases.map((b) => (
        <button
          key={b.path}
          onClick={() => onPick(b.path)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            background: "none",
            border: "none",
            borderRadius: 4,
            color: "var(--fg)",
            cursor: "pointer",
            textAlign: "left",
            fontSize: 13,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--row-hover, rgba(127,127,127,0.12))";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "none";
          }}
        >
          <span style={{ color: "var(--fg-muted)", fontSize: 12 }}>📊</span>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {b.path}
          </span>
        </button>
      ))}
    </div>
  );
}

