import { useCallback, useEffect, useMemo, useState } from "react";
import { useUiStore } from "../stores/uiStore";
import { useVaultStore } from "../stores/vaultStore";
import { useI18n } from "../lib/i18n";
import { queryFolderTable, type FolderTable, type FolderTableRow } from "../lib/ipc";
import { openNote } from "../lib/openNote";
import {
  sortAndFilterRows,
  nextSortDir,
  DEFAULT_SORT,
  type SortState,
} from "../lib/base";
import { writeFrontmatterKey } from "../lib/noteProps";
import { TableView } from "./BaseTable";

/**
 * Folder table view — the Yuque-style "folder as database" mapping:
 * rows are the folder's direct `.md` notes, columns are the union of their
 * frontmatter keys with auto-inferred types (number/date/tags/text). No
 * `.base` file required; cell edits write back to the note's frontmatter.
 */
export function FolderTableDialog() {
  const open = useUiStore((s) => s.folderTableOpen);
  const setOpen = useUiStore((s) => s.setFolderTableOpen);
  const folder = useUiStore((s) => s.folderTableFolder);
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const t = useI18n();

  const [table, setTable] = useState<FolderTable | null>(null);
  const [rows, setRows] = useState<FolderTableRow[]>([]);
  const [err, setErr] = useState("");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ row: string; field: string } | null>(null);

  useEffect(() => {
    if (!open || folder === null || !vaultRoot) {
      setTable(null);
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
        const out = await queryFolderTable(vaultRoot, folder ?? "");
        if (cancelled) return;
        setTable(out);
        setRows(out.rows);
        setErr("");
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
  }, [open, folder, vaultRoot]);

  const view = useMemo(() => sortAndFilterRows(rows, sort, filters), [rows, sort, filters]);

  const openRow = useCallback(
    (path: string) => {
      if (!vaultRoot) return;
      void openNote(vaultRoot, path);
    },
    [vaultRoot],
  );

  if (!open || folder === null) return null;

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
        if (e.target === e.currentTarget) setOpen(false);
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
          <div style={{ fontWeight: 600, fontSize: 14, color: "var(--fg)", flex: 1 }}>
            {t.folderTableTitle(folder)}
          </div>
          <button
            onClick={() => setOpen(false)}
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
        <TableView
          fields={table?.columns ?? []}
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
      </div>
    </div>
  );
}
