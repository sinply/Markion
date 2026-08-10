import React, { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { createEditorState, setLivePreview, setEditorMode } from "./codemirror";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";

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
      onStateChangeRef.current?.(state);
      return () => view.destroy();
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

    return <div ref={containerRef} className="markdown-editor" style={{ height: "100%" }} />;
  },
);
