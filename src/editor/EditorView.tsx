import React, { useRef, useEffect, useImperativeHandle, forwardRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { createEditorState, setLivePreview, setEditorMode, type EditorMode } from "./codemirror";
import { useSettingsStore } from "../stores/settingsStore";

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
  mode?: EditorMode;
  onModeChange?: (mode: EditorMode) => void;
}

export const MarkdownEditor = forwardRef<EditorHandle, EditorViewProps>(
  function MarkdownEditor(
    { doc, onChange, onStateChange, vaultRoot, docRel, mode = "live", onModeChange },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onStateChangeRef = useRef(onStateChange);
    onStateChangeRef.current = onStateChange;
    const livePreview = useSettingsStore((s) => s.livePreview);
    const [currentMode, setCurrentMode] = useState<EditorMode>(mode);

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
      // Emit initial state so the outline populates immediately
      onStateChangeRef.current?.(state);
      return () => view.destroy();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Toggle live preview dynamically when the setting changes
    useEffect(() => {
      if (viewRef.current && currentMode === "live") {
        setLivePreview(viewRef.current, livePreview);
      }
    }, [livePreview, currentMode]);

    const switchMode = (next: EditorMode) => {
      setCurrentMode(next);
      onModeChange?.(next);
      if (viewRef.current) {
        setEditorMode(viewRef.current, next);
        if (next === "live") {
          setLivePreview(viewRef.current, livePreview);
        }
      }
    };

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
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div className="markion-modebar">
          <button
            className={`markion-mode-btn ${currentMode === "live" ? "active" : ""}`}
            onClick={() => switchMode("live")}
            title="Edit mode (Ctrl+E)"
          >
            ✏️ Edit
          </button>
          <button
            className={`markion-mode-btn ${currentMode === "preview" ? "active" : ""}`}
            onClick={() => switchMode("preview")}
            title="Preview mode (Ctrl+Shift+E)"
          >
            👁️ Preview
          </button>
        </div>
        <div ref={containerRef} className="markdown-editor" style={{ flex: 1, minHeight: 0 }} />
      </div>
    );
  },
);
