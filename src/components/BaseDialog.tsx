import { useCallback, useEffect, useMemo, useState } from "react";
import { useUiStore } from "../stores/uiStore";
import { useVaultStore } from "../stores/vaultStore";
import { useI18n } from "../lib/i18n";
import { buildTree, readFile, writeFileAtomic } from "../lib/ipc";
import { openNote } from "../lib/openNote";
import {
  extractFrontmatter,
  parseFrontmatter,
  replaceFrontmatter,
} from "../lib/frontmatter";
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

/** Walk the tree and collect `.md` rows directly inside the configured folder.
 *  We do NOT recurse into subfolders (matches Obsidian Base: rows are the
 *  folder's immediate .md files). */
function collectRows(
  node: { name: string; path: string; kind: string; children: any[] },
  target: string,
  rows: BaseRow[],
) {
  if (node.kind === "file") {
    if (!node.name.toLowerCase().endsWith(".md")) return;
    if (parentOf(node.path) === target) {
      rows.push({
        path: node.path,
        name: node.name.replace(/\.md$/i, ""),
        values: {},
      });
    }
    return;
  }
  for (const c of node.children ?? []) {
    if (c.kind === "file") {
      if (!c.name.toLowerCase().endsWith(".md")) continue;
      if (parentOf(c.path) === target) {
        rows.push({
          path: c.path,
          name: c.name.replace(/\.md$/i, ""),
          values: {},
        });
      }
    }
    // Intentionally do NOT descend into nested folders — the spec limits
    // rows to files directly under `folder`.
  }
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

/** Update a single frontmatter key in `text`, preserving the body. */
async function writeFrontmatterKey(
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

/** Render a single cell. When editing, it shows an input; otherwise the value
 *  (or a muted dash for empty). */
function Cell({
  value,
  editing,
  onCommit,
  onCancel,
}: {
  value: string;
  editing: boolean;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (editing) setDraft(value);
  }, [editing, value]);
  if (!editing) {
    return (
      <span
        title={value}
        style={{
          display: "block",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: value ? "var(--fg)" : "var(--fg-muted)",
        }}
      >
        {value || "—"}
      </span>
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(draft);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      style={{
        width: "100%",
        padding: "2px 6px",
        border: "1px solid var(--accent)",
        borderRadius: 3,
        background: "var(--bg)",
        color: "var(--fg)",
        fontSize: 13,
        outline: "none",
        boxSizing: "border-box",
      }}
    />
  );
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
            def={def}
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

function TableView({
  def,
  rows,
  err,
  sort,
  filters,
  editing,
  t,
  onHeaderClick,
  onFilterChange,
  onCellStartEdit,
  onCellCommit,
  onCellCancel,
  onRowOpen,
}: {
  def: BaseDefinition;
  rows: BaseRow[];
  err: string;
  sort: SortState;
  filters: Record<string, string>;
  editing: { row: string; field: string } | null;
  t: Dict;
  onHeaderClick: (field: string) => void;
  onFilterChange: (field: string, value: string) => void;
  onCellStartEdit: (row: string, field: string) => void;
  onCellCommit: (row: string, field: string, value: string) => void;
  onCellCancel: () => void;
  onRowOpen: (path: string) => void;
}) {
  const sortIndicator = (field: string) => {
    if (sort.field !== field) return "";
    if (sort.dir === "asc") return " ▲";
    if (sort.dir === "desc") return " ▼";
    return "";
  };

  const headerCell = (field: string, label: string, isTitle: boolean) => (
    <th
      onClick={() => onHeaderClick(field)}
      style={{
        textAlign: "left",
        padding: "6px 8px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg, transparent)",
        fontWeight: 600,
        fontSize: 12,
        color: isTitle ? "var(--accent, var(--fg))" : "var(--fg)",
        cursor: "pointer",
        userSelect: "none",
        minWidth: 100,
      }}
    >
      {label}
      <span style={{ opacity: 0.6 }}>{sortIndicator(field)}</span>
    </th>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      {err && (
        <div style={{ padding: "6px 12px", color: "#d73a49", fontSize: 12, borderBottom: "1px solid var(--border)" }}>
          {err}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            <col style={{ width: 200 }} />
            {def.fields.map((f) => (
              <col key={f.name} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {headerCell("", t.baseTitleCol ?? "File", true)}
              {def.fields.map((f) => headerCell(f.name, f.name, false))}
            </tr>
            <tr>
              <th
                style={{
                  padding: "4px 8px",
                  borderBottom: "1px solid var(--border)",
                  background: "var(--bg, transparent)",
                  textAlign: "left",
                }}
              />
              {def.fields.map((f) => (
                <th
                  key={f.name}
                  style={{
                    padding: "4px 6px",
                    borderBottom: "1px solid var(--border)",
                    background: "var(--bg, transparent)",
                    textAlign: "left",
                    fontWeight: 400,
                  }}
                >
                  <input
                    value={filters[f.name] ?? ""}
                    placeholder={t.baseFilter ?? "filter…"}
                    onChange={(e) => onFilterChange(f.name, e.target.value)}
                    style={{
                      width: "100%",
                      padding: "2px 6px",
                      border: "1px solid var(--border)",
                      borderRadius: 3,
                      background: "var(--bg)",
                      color: "var(--fg)",
                      fontSize: 12,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={1 + def.fields.length}
                  style={{ padding: 16, color: "var(--fg-muted)", fontSize: 13, textAlign: "center" }}
                >
                  {t.baseEmpty}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.path}
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <td
                  style={{
                    padding: "4px 8px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  <button
                    onClick={() => onRowOpen(r.path)}
                    title={r.path}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      color: "var(--accent)",
                      cursor: "pointer",
                      fontSize: 13,
                      textAlign: "left",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: "100%",
                    }}
                  >
                    {r.name}
                  </button>
                </td>
                {def.fields.map((f) => {
                  const isEditing =
                    editing?.row === r.path && editing.field === f.name;
                  return (
                    <td
                      key={f.name}
                      onDoubleClick={() => onCellStartEdit(r.path, f.name)}
                      style={{
                        padding: "2px 6px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 280,
                      }}
                    >
                      <Cell
                        value={r.values[f.name] ?? ""}
                        editing={isEditing}
                        onCommit={(v) => onCellCommit(r.path, f.name, v)}
                        onCancel={onCellCancel}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
