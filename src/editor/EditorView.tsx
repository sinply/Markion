import React, { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { createEditorState, setLivePreview, setEditorMode } from "./codemirror";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import { setEditorView } from "./registry";

export interface EditorHandle {
  getDoc(): string;
  setDoc(doc: string): void;
  view: EditorView | null;
}

interface EditorViewProps {
  doc: string;
  onChange?: (doc: string) => void;
  onStateChange?: (state: EditorState) => void;
  vaultRoot?: string;
  docRel?: string;
}

export const MarkdownEditor = forwardRef<EditorHandle, EditorViewProps>(
  function MarkdownEditor({ doc, onChange, onStateChange, vaultRoot, docRel }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onStateChangeRef = useRef(onStateChange);
    onStateChangeRef.current = onStateChange;
    const livePreview = useSettingsStore((s) => s.livePreview);
    const mode = useUiStore((s) => s.editorMode);
    const setEditorModeUi = useUiStore((s) => s.setEditorMode);

    useEffect(() => {
      if (!containerRef.current) return;
      const state = createEditorState(doc, (newDoc) => {
        onChangeRef.current?.(newDoc);
      }, {
        livePreview,
        onStateChange: (s) => onStateChangeRef.current?.(s),
        markdownContext:
          vaultRoot && docRel ? { vaultRoot, docRel } : undefined,
      });
      const view = new EditorView({ state, parent: containerRef.current });
      viewRef.current = view;
      setEditorView(view);
      onStateChangeRef.current?.(state);
      return () => {
        setEditorView(null);
        view.destroy();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Live-preview decorations depend on the settings toggle.
    useEffect(() => {
      if (viewRef.current && mode === "live") {
        setLivePreview(viewRef.current, livePreview);
      }
    }, [livePreview, mode]);

    // Edit/Preview mode is controlled globally via the View menu.
    useEffect(() => {
      if (viewRef.current) {
        setEditorMode(viewRef.current, mode);
        if (mode === "live") {
          setLivePreview(viewRef.current, livePreview);
        }
      }
    }, [mode, livePreview]);

    useImperativeHandle(ref, () => ({
      getDoc: () => viewRef.current?.state.doc.toString() ?? "",
      setDoc: (newDoc: string) => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: newDoc },
        });
      },
      get view() {
        return viewRef.current;
      },
    }));

    return (
      <div style={{ position: "relative", height: "100%" }}>
        <div ref={containerRef} className="markdown-editor" style={{ height: "100%" }} />
        <div style={{ position: "absolute", top: 6, right: 8, display: "flex", gap: 4, zIndex: 10 }}>
          <button
            className="markion-mode-btn"
            style={{ padding: "2px 10px", fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", borderRadius: 5, background: mode === "live" ? "var(--accent)" : "var(--bg)", color: mode === "live" ? "var(--accent-fg)" : "var(--fg)" }}
            onClick={() => setEditorModeUi("live")}
            title="Edit mode (Ctrl+E)"
          >
            ✏️ Edit
          </button>
          <button
            className="markion-mode-btn"
            style={{ padding: "2px 10px", fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", borderRadius: 5, background: mode === "preview" ? "var(--accent)" : "var(--bg)", color: mode === "preview" ? "var(--accent-fg)" : "var(--fg)" }}
            onClick={() => setEditorModeUi("preview")}
            title="Preview mode (Ctrl+E)"
          >
            👁️ Preview
          </button>
        </div>
      </div>
    );
  },
);
