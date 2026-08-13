import { useRef, useCallback, useEffect, useMemo } from "react";
import { useDocStore } from "../stores/docStore";
import { useVaultStore } from "../stores/vaultStore";
import { useSettingsStore } from "../stores/settingsStore";
import { readFile, writeFileAtomic } from "../lib/ipc";
import { MarkdownEditor, type EditorHandle } from "../editor/EditorView";
import { Tabs } from "./Tabs";
import type { EditorState } from "@codemirror/state";

export function EditorPane({
  onHeadingsChange,
}: {
  onHeadingsChange: (state: EditorState | null) => void;
}) {
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const activeDocId = useDocStore((s) => s.activeDocId);
  const openDocs = useDocStore((s) => s.openDocs);
  const openDoc = useDocStore((s) => s.openDoc);
  const markDirty = useDocStore((s) => s.markDirty);
  const markClean = useDocStore((s) => s.markClean);
  const markSaved = useDocStore((s) => s.markSaved);
  const activeContent = useDocStore((s) => s.activeContent);
  const activeContentDocId = useDocStore((s) => s.activeContentDocId);
  const setActiveContent = useDocStore((s) => s.setActiveContent);
  const dirtyMap = useDocStore((s) => s.dirtyMap);
  const showWordCount = useSettingsStore((s) => s.showWordCount);

  const editorRef = useRef<EditorHandle>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeDoc = openDocs.find((d) => d.id === activeDocId);

  // Word count (CJK-aware: count CJK chars as words, others by whitespace tokens).
  const wordCount = useMemo(() => {
    if (!activeContent) return 0;
    const s = activeContent.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
    const cjk = (s.match(/[一-鿿぀-ヿ가-힯]/g) || []).length;
    const ascii = (s.replace(/[一-鿿぀-ヿ가-힯]/g, " ").match(/\S+/g) || []).length;
    return cjk + ascii;
  }, [activeContent]);

  // Clear the outline when no document is open
  useEffect(() => {
    if (!activeDoc) onHeadingsChange(null);
  }, [activeDoc, onHeadingsChange]);

  // Load the active document's content from disk when the active doc changes
  // and the cached content doesn't belong to it (open / switch / close tab).
  useEffect(() => {
    if (!activeDoc || !vaultRoot) return;
    if (activeContentDocId === activeDoc.id) return; // content already correct
    let cancelled = false;
    void (async () => {
      try {
        const content = await readFile(vaultRoot, activeDoc.path);
        if (!cancelled) setActiveContent(content);
      } catch {
        // Read failed — set empty content owned by this doc so the editor is
        // still editable and we don't loop on Loading.
        if (!cancelled) setActiveContent("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeDoc, activeDocId, activeContentDocId, vaultRoot, setActiveContent]);

  const handleChange = useCallback(
    (doc: string) => {
      if (!activeDocId) return;
      markDirty(activeDocId);
      // Debounce auto-save: 1s after last keystroke
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        if (!vaultRoot || !activeDocId) return;
        try {
          const docPath = useDocStore.getState().openDocs.find((d) => d.id === activeDocId)?.path;
          if (docPath) {
            await writeFileAtomic(vaultRoot, docPath, doc);
            markSaved(activeDocId, doc);
            markClean(activeDocId);
          }
        } catch {
          // save failed — mark stays dirty, toast on next error UI cycle
        }
      }, 1000);
    },
    [activeDocId, vaultRoot, markDirty, markClean],
  );

  // Notify parent of heading changes whenever editor updates
  const handleEditorMount = useCallback(() => {
    // Read editor state periodically for outline (simplified: use a poll approach
    // or hook into CM6 updates). For v1, we expose the view for the parent to query.
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Tabs />
      <div style={{ flex: 1, overflow: "auto" }}>
        {activeDoc ? (
          activeContentDocId === activeDoc.id ? (
            <MarkdownEditor
              key={activeDoc.id}
              ref={editorRef}
              doc={activeContent}
              vaultRoot={vaultRoot ?? undefined}
              docRel={activeDoc?.path}
              onChange={handleChange}
              onStateChange={(state) => onHeadingsChange(state)}
            />
          ) : (
            <div style={{ padding: 16, color: "var(--fg-muted)" }}>
              Loading…
            </div>
          )
        ) : (
          <div style={{ padding: 16, color: "var(--fg-muted)" }}>
            Open a file from the tree to edit
          </div>
        )}
      </div>
      <div
        style={{
          padding: "3px 8px",
          fontSize: 11,
          color: "var(--fg-muted)",
          borderTop: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span>{activeDoc?.path ?? "no file"}</span>
        <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {showWordCount && activeDoc && (
            <span>
              {wordCount} words · {activeContent.length} chars
            </span>
          )}
          <span>
            {activeDocId && dirtyMap[activeDocId] ? "● unsaved" : "saved"}
          </span>
        </span>
      </div>
    </div>
  );
}
