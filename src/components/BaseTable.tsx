import { useState, useEffect } from "react";
import { useI18n } from "../lib/i18n";

type Dict = ReturnType<typeof useI18n>;

/** Render a single cell. When editing, it shows an input; otherwise the value
 *  (or a muted dash for empty). Shared by the .base dialog and the folder
 *  table view. */
export function Cell({
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

/** Sortable / filterable / inline-editable table. `fields` are the property
 *  columns (the row title column is implicit and always first). Only the
 *  column NAME is required — both .base fields and inferred folder-table
 *  columns satisfy this shape. */
export function TableView({
  fields,
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
  fields: { name: string }[];
  rows: { path: string; name: string; values: Record<string, string> }[];
  err: string;
  sort: import("../lib/base").SortState;
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
            {fields.map((f) => (
              <col key={f.name} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {headerCell("", t.baseTitleCol ?? "File", true)}
              {fields.map((f) => headerCell(f.name, f.name, false))}
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
              {fields.map((f) => (
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
                  colSpan={1 + fields.length}
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
                {fields.map((f) => {
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
