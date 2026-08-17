import { useEffect, useMemo, useRef, useState } from "react";
import { useVaultStore } from "../stores/vaultStore";
import { useUiStore } from "../stores/uiStore";
import { useDocStore } from "../stores/docStore";
import { searchVault, type SearchHit } from "../lib/ipc";
import { openNote } from "../lib/openNote";
import { useI18n } from "../lib/i18n";

const DEBOUNCE_MS = 250;

/** Flatten hits into one navigable list (file headers are not selectable).
 *  Exported for tests. */
export function flatHits(hits: SearchHit[]): { hit: SearchHit; firstInFile: boolean }[] {
  const out: { hit: SearchHit; firstInFile: boolean }[] = [];
  let lastPath: string | null = null;
  for (const hit of hits) {
    const firstInFile = hit.path !== lastPath;
    out.push({ hit, firstInFile });
    lastPath = hit.path;
  }
  return out;
}

export function SearchDialog() {
  const open = useUiStore((s) => s.searchOpen);
  const setOpen = useUiStore((s) => s.setSearchOpen);
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const t = useI18n();

  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    if (!vaultRoot) return;
    const q = query.trim();
    if (!q) {
      setHits([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const result = await searchVault(vaultRoot, q, { caseSensitive });
        setHits(result);
        setSel(0);
      } catch (e) {
        setError(String(e));
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, caseSensitive, vaultRoot, open]);

  // Reset when the dialog is (re)opened.
  useEffect(() => {
    if (open) {
      setQuery("");
      setCaseSensitive(false);
      setHits([]);
      setError(null);
      setLoading(false);
      setSel(0);
      // Focus after the dialog renders.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const flat = useMemo(() => flatHits(hits), [hits]);

  if (!open) return null;

  const jumpTo = async (hit: SearchHit) => {
    setOpen(false);
    if (!vaultRoot) return;
    const active = useDocStore.getState().openDocs.find(
      (d) => d.id === useDocStore.getState().activeDocId,
    );
    // If the hit is already the active doc, skip the re-read and jump directly.
    if (!active || active.path !== hit.path) {
      await openNote(vaultRoot, hit.path);
    }
    useUiStore.getState().setPendingJump({ path: hit.path, line: hit.line, column: hit.column });
  };

  const move = (delta: number) => {
    setSel((s) => Math.max(0, Math.min(flat.length - 1, s + delta)));
  };

  return (
    <div
      style={{
        position: "fixed", top: "12%", left: "25%", width: "50%", maxHeight: "70%",
        background: "var(--bg)", boxShadow: "0 6px 30px rgba(0,0,0,0.3)", borderRadius: 10,
        zIndex: 1100, overflow: "hidden", display: "flex", flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)" }}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
            else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
            else if (e.key === "Enter" && flat[sel]) { e.preventDefault(); void jumpTo(flat[sel].hit); }
            else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
          }}
          placeholder={t.searchPlaceholder}
          style={{
            flex: 1, boxSizing: "border-box", padding: "10px 14px",
            fontSize: 15, border: "none", outline: "none",
            background: "var(--bg)", color: "var(--fg)",
          }}
        />
        <label
          style={{
            display: "flex", alignItems: "center", gap: 4, padding: "0 12px",
            fontSize: 12, color: "var(--fg-muted)", cursor: "pointer", userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          {t.searchCaseSensitive}
        </label>
        <button
          onClick={() => setOpen(false)}
          style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 18, color: "var(--fg-muted)", padding: "0 12px" }}
        >
          ×
        </button>
      </div>
      <div style={{ overflow: "auto", flex: 1, minHeight: 60 }}>
        {loading && (
          <div style={{ padding: "8px 14px", fontSize: 13, color: "var(--fg-muted)" }}>
            {t.searchScanning}
          </div>
        )}
        {!loading && error && (
          <div style={{ padding: "8px 14px", fontSize: 13, color: "var(--fg-muted)" }}>
            {error}
          </div>
        )}
        {!loading && !error && query.trim() !== "" && flat.length === 0 && (
          <div style={{ padding: "8px 14px", fontSize: 13, color: "var(--fg-muted)" }}>
            {t.searchNoResults}
          </div>
        )}
        {flat.map(({ hit, firstInFile }, i) => {
          const active = i === sel;
          return (
            <div key={`${hit.path}:${hit.line}:${hit.column}`}>
              {firstInFile && (
                <div
                  style={{
                    padding: "4px 14px", fontSize: 12, fontWeight: 600,
                    color: "var(--fg-muted)", background: "var(--panel-bg)",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  📄 {hit.title} <span style={{ fontWeight: 400, opacity: 0.7 }}>{hit.path}</span>
                </div>
              )}
              <div
                onClick={() => void jumpTo(hit)}
                onMouseEnter={() => setSel(i)}
                style={{
                  padding: "4px 14px 4px 28px", cursor: "pointer",
                  borderBottom: "1px solid var(--border)", fontSize: 13,
                  background: active ? "var(--accent)" : "transparent",
                  color: active ? "var(--accent-fg)" : "var(--fg)",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}
              >
                <span style={{ opacity: 0.7, marginRight: 8, fontSize: 11 }}>
                  {hit.line}:{hit.column}
                </span>
                {hit.snippet}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
