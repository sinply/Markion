import React, { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { createEditorState, setLivePreview } from "./codemirror";
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
}

export const MarkdownEditor = forwardRef<EditorHandle, EditorViewProps>(
  function MarkdownEditor({ doc, onChange, onStateChange }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onStateChangeRef = useRef(onStateChange);
    onStateChangeRef.current = onStateChange;
    const livePreview = useSettingsStore((s) => s.livePreview);

    useEffect(() => {
      if (!containerRef.current) return;
      const state = createEditorState(doc, (newDoc) => {
        onChangeRef.current?.(newDoc);
      }, {
        livePreview,
        onStateChange: (s) => onStateChangeRef.current?.(s),
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
      if (viewRef.current) {
        setLivePreview(viewRef.current, livePreview);
      }
    }, [livePreview]);

    useImperativeHandle(ref, () => ({
      getDoc: () => viewRef.current?.state.doc.toString() ?? "",
      setDoc: (newDoc: string) => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: newDoc },
        });
      },
      view: viewRef.current,
    }));

    return <div ref={containerRef} className="markdown-editor" />;
  },
);
