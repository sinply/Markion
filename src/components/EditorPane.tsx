import { useRef, useCallback, useEffect } from "react";
import { useDocStore } from "../stores/docStore";
import { useVaultStore } from "../stores/vaultStore";
import { writeFileAtomic } from "../lib/ipc";
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
  const activeContent = useDocStore((s) => s.activeContent);
  const setActiveContent = useDocStore((s) => s.setActiveContent);
  const dirtyMap = useDocStore((s) => s.dirtyMap);

  const editorRef = useRef<EditorHandle>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeDoc = openDocs.find((d) => d.id === activeDocId);

  // Clear the outline when no document is open
  useEffect(() => {
    if (!activeDoc) onHeadingsChange(null);
  }, [activeDoc, onHeadingsChange]);

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
        }}
      >
        <span>{activeDoc?.path ?? "no file"}</span>
        <span>
          {activeDocId && dirtyMap[activeDocId] ? "● unsaved" : "saved"}
        </span>
      </div>
    </div>
  );
}
