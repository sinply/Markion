import { useEffect, useMemo, useState } from "react";
import { useVaultStore } from "../stores/vaultStore";
import { useSettingsStore } from "../stores/settingsStore";
import { scanTags, type TagEntry } from "../lib/ipc";
import { openNote } from "../lib/openNote";
import { useI18n } from "../lib/i18n";

/** Aggregate tags from the backend scan: tag -> sorted unique file entries. */
export function groupTags(entries: TagEntry[]): Map<string, TagEntry[]> {
  const map = new Map<string, TagEntry[]>();
  for (const e of entries) {
    const list = map.get(e.tag);
    if (list) {
      list.push(e);
    } else {
      map.set(e.tag, [e]);
    }
  }
  // Sort each tag's files deterministically.
  for (const list of map.values()) {
    list.sort((a, b) => a.path.localeCompare(b.path));
  }
  return map;
}

export function TagsPanel() {
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const showTags = useSettingsStore((s) => s.showTags);
  const t = useI18n();
  const [entries, setEntries] = useState<TagEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!showTags) return;
    let cancelled = false;
    const load = async () => {
      if (!vaultRoot) {
        setEntries([]);
        return;
      }
      setLoading(true);
      try {
        const result = await scanTags(vaultRoot);
        if (!cancelled) setEntries(result);
      } catch {
        if (!cancelled) setEntries([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [vaultRoot, showTags]);

  // If the selected tag vanishes after a rescan, fall back to the list view.
  useEffect(() => {
    if (selected && !groupTags(entries).has(selected)) setSelected(null);
  }, [entries, selected]);

  const byTag = useMemo(() => groupTags(entries), [entries]);

  if (!showTags) return null;

  const openDoc = (path: string) => {
    if (vaultRoot) void openNote(vaultRoot, path);
  };

  // Sorted by count desc, then name asc — most-used tags on top.
  const sortedTags = [...byTag.entries()].sort((a, b) => {
    const byCount = b[1].length - a[1].length;
    return byCount !== 0 ? byCount : a[0].localeCompare(b[0]);
  });

  return (
    <div style={{ padding: 8, overflow: "hidden", fontSize: 13 }}>
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 12, color: "var(--fg-muted)" }}>
        {t.tagsTitle}
      </div>
      {loading && <div style={{ color: "var(--fg-muted)" }}>{t.searchScanning}</div>}
      {!loading && entries.length === 0 && (
        <div style={{ color: "var(--fg-muted)" }}>{t.tagsEmpty}</div>
      )}
      {!loading && selected === null && sortedTags.map(([tag, files]) => (
        <div
          key={tag}
          data-tag={tag}
          onClick={() => setSelected(tag)}
          style={{
            padding: "3px 6px",
            margin: "2px 0",
            cursor: "pointer",
            borderRadius: 4,
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--bg-hover, rgba(0,0,0,0.06))";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          <span style={{ color: "var(--accent)" }}>#{tag}</span>
          <span style={{ color: "var(--fg-muted)" }}>{files.length}</span>
        </div>
      ))}
      {!loading && selected !== null && (
        <>
          <div
            data-back
            onClick={() => setSelected(null)}
            style={{ cursor: "pointer", color: "var(--fg-muted)", marginBottom: 6, fontSize: 12 }}
          >
            ← {t.tagsBack}
          </div>
          {(byTag.get(selected) ?? []).map((e) => (
            <div
              key={e.path}
              data-file={e.path}
              onClick={() => openDoc(e.path)}
              style={{ padding: "2px 0", cursor: "pointer", color: "var(--accent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {e.title}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
