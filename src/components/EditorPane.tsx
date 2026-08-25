import { useRef, useCallback, useEffect, useMemo } from "react";
import { useDocStore } from "../stores/docStore";
import { useVaultStore } from "../stores/vaultStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import { readFile, writeFileAtomic } from "../lib/ipc";
import { getEditorView } from "../editor/registry";
import { MarkdownEditor, type EditorHandle } from "../editor/EditorView";
import { Tabs } from "./Tabs";
import { FolderContainer } from "./FolderContainer";
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
  // Per-doc autosave timer. Switching tabs (or closing a tab) within the
  // debounce window must not cancel a pending save for another doc — the
  // timer closure already captured that doc's path and content. Only a
  // further keystroke in the SAME doc supersedes it.
  const saveTimer = useRef<{ docId: string; timer: ReturnType<typeof setTimeout> } | null>(null);

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
      const id = activeDocId;
      if (!id) return;
      markDirty(id);
      // Keep the store's activeContent in sync with live edits so manual
      // Save / Save As / exports / word count read the CURRENT text, not the
      // open-time snapshot. setActiveContent captures activeDocId (== id).
      setActiveContent(doc);
      // Debounce auto-save: 1s after last keystroke IN THE SAME DOC. A
      // different doc's pending timer is left alone (its closure owns the
      // path + content it will write).
      if (saveTimer.current?.docId === id) clearTimeout(saveTimer.current.timer);
      const docPath = useDocStore.getState().openDocs.find((d) => d.id === id)?.path;
      saveTimer.current = {
        docId: id,
        timer: setTimeout(async () => {
          const state = useDocStore.getState();
          const path = state.openDocs.find((d) => d.id === id)?.path;
          // Skip the write while an external-change conflict is open for this
          // doc: overwriting the file would clobber the very change the user
          // is deciding about (last-writer-wins destroys external edits).
          const conflict = useUiStore.getState().conflict;
          if (conflict && conflict.path === path) return;
          if (!vaultRoot || !path) return;
          const content = state.activeContentDocId === id ? state.activeContent : doc;
          try {
            await writeFileAtomic(vaultRoot, path, content);
            markSaved(id, content);
            markClean(id);
          } catch {
            // save failed — mark stays dirty, toast on next error UI cycle
          }
        }, 1000),
      };
    },
    [activeDocId, vaultRoot, markDirty, markClean, setActiveContent],
  );

  // Jump to a search result: when the pendingJump targets the active doc and
  // its content is loaded, move the cursor (and scroll) to line:column.
  const pendingJump = useUiStore((s) => s.pendingJump);
  const setPendingJump = useUiStore((s) => s.setPendingJump);
  useEffect(() => {
    if (!pendingJump || !activeDoc) return;
    if (pendingJump.path !== activeDoc.path) return;
    if (activeContentDocId !== activeDoc.id) return; // content not ready yet
    const view = getEditorView();
    if (!view) return;
    const line = Math.min(Math.max(1, pendingJump.line), view.state.doc.lines);
    const lineStart = view.state.doc.line(line).from;
    const pos = Math.min(lineStart + Math.max(0, pendingJump.column - 1), view.state.doc.length);
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    view.focus();
    setPendingJump(null);
  }, [pendingJump, activeDoc, activeContentDocId, setPendingJump]);

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
      {/* Folder-as-container: sibling notes under an open index.md */}
      <FolderContainer />
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
