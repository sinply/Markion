import { useEffect, useMemo, useState } from "react";
import { useUiStore } from "../stores/uiStore";
import { useVaultStore } from "../stores/vaultStore";
import { useI18n } from "../lib/i18n";
import { queryLibrary, type LibraryEntry } from "../lib/ipc";
import { openNote } from "../lib/openNote";
import { dayDelta, fmtDate } from "../lib/relativeTime";
import type { TreeNode } from "../lib/types";

type Dict = ReturnType<typeof useI18n>;

/** Collect every folder path (depth-first) for the filter dropdown. */
export function collectFolders(node: TreeNode | null): string[] {
  const out: string[] = [];
  const walk = (n: TreeNode) => {
    for (const c of n.children) {
      if (c.kind === "folder") {
        out.push(c.path);
        walk(c);
      }
    }
  };
  if (node) walk(node);
  return out;
}

function relativeLabel(mtimeSecs: number, t: Dict): string {
  const delta = dayDelta(mtimeSecs);
  if (delta <= 0) return t.today;
  if (delta === 1) return t.yesterday;
  if (delta <= 6) return t.daysAgo(delta);
  return fmtDate(mtimeSecs);
}

/** Yuque-style library home: a card grid over the document projection.
 *  Pure presentation + one IPC query; opening a card goes through openNote. */
export function LibraryHome() {
  const show = useUiStore((s) => s.showHome);
  const setShow = useUiStore((s) => s.setShowHome);
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const tree = useVaultStore((s) => s.tree);
  const t = useI18n();
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [folder, setFolder] = useState<string>("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!show || !vaultRoot) return;
    let cancelled = false;
    setLoading(true);
    queryLibrary(vaultRoot, folder || null)
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [show, vaultRoot, folder]);

  const folders = useMemo(() => collectFolders(tree), [tree]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        if (!q) return true;
        if (e.title.toLowerCase().includes(q) || e.path.toLowerCase().includes(q)) return true;
        return e.tags.some((tag) => tag.toLowerCase().includes(q));
      }),
    [entries, q],
  );

  if (!show) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 900,
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header: title + search + folder filter + close */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 22px",
          borderBottom: "1px solid var(--border)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--fg)" }}>{t.libraryHome}</div>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.librarySearch}
          style={{
            flex: 1,
            minWidth: 180,
            maxWidth: 420,
            padding: "6px 12px",
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg)",
            color: "var(--fg)",
            fontSize: 13,
            outline: "none",
          }}
        />
        <select
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          style={{
            padding: "6px 8px",
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg)",
            color: "var(--fg)",
            fontSize: 13,
            outline: "none",
            maxWidth: 200,
          }}
        >
          <option value="">{t.libraryAllFolders}</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button
          onClick={() => setShow(false)}
          title={t.exit}
          style={{
            background: "none",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--fg-muted)",
            cursor: "pointer",
            fontSize: 13,
            padding: "5px 12px",
          }}
        >
          ✕
        </button>
      </div>

      {/* Card grid */}
      <div style={{ flex: 1, overflow: "auto", padding: "18px 22px" }}>
        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--fg-muted)", fontSize: 14, padding: 40 }}>
            {t.libraryEmpty}
          </div>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 14,
          }}
        >
          {filtered.map((e) => (
            <div
              key={e.path}
              onClick={() => {
                if (vaultRoot) void openNote(vaultRoot, e.path);
              }}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "12px 14px",
                cursor: "pointer",
                background: "var(--panel-bg, transparent)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                minHeight: 108,
              }}
              onMouseEnter={(ev) => {
                (ev.currentTarget as HTMLElement).style.borderColor = "var(--accent)";
              }}
              onMouseLeave={(ev) => {
                (ev.currentTarget as HTMLElement).style.borderColor = "var(--border)";
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 14,
                  color: "var(--fg)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={e.path}
              >
                {e.title}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--fg-muted)",
                  lineHeight: 1.5,
                  height: 38,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {e.summary || "\u00a0"}
              </div>
              <div
                style={{
                  marginTop: "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>
                  {relativeLabel(e.mtimeSecs, t)} · {t.wordsUnit(e.wordCount)}
                </span>
                {e.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    style={{
                      fontSize: 10.5,
                      color: "var(--accent)",
                      border: "1px solid var(--border)",
                      borderRadius: 999,
                      padding: "1px 7px",
                    }}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
