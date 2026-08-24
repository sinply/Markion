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
  /** Live rebuild progress from the backend (`index-progress` events). */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (!show || !vaultRoot) return;
    let cancelled = false;
    setLoading(true);
    setProgress(null);
    queryLibrary(vaultRoot, folder || null)
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setProgress(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [show, vaultRoot, folder]);

  // Cold-start index progress (emitted by query_library while rebuilding).
  useEffect(() => {
    if (!show) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<{ done: number; total: number }>("index-progress", (e) => {
        if (cancelled) return;
        const { done, total } = e.payload;
        setProgress(done < 0 ? null : { done, total });
      }),
    ).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [show]);

  // Escape leaves the library home.
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShow(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, setShow]);

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
        // Absolute (not fixed): covers the Layout area only, so the menu bar
        // on top stays visible and clickable.
        position: "absolute",
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
          title={t.close}
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
        {loading && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              color: "var(--fg-muted)",
              fontSize: 14,
              padding: 40,
            }}
          >
            <div>
              {t.libraryIndexing}
              {progress && progress.total > 0
                ? ` ${progress.done}/${progress.total}`
                : "…"}
            </div>
            <div
              style={{
                width: "min(320px, 70%)",
                height: 6,
                borderRadius: 3,
                background: "var(--border)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width:
                    progress && progress.total > 0
                      ? `${Math.max(4, Math.round((progress.done / progress.total) * 100))}%`
                      : "30%",
                  borderRadius: 3,
                  background: "var(--accent)",
                  transition: "width 0.15s ease",
                  // Indeterminate shimmer until the first event arrives.
                  animation:
                    progress && progress.total > 0 ? undefined : "indexPulse 1.2s ease-in-out infinite alternate",
                }}
              />
            </div>
          </div>
        )}
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
