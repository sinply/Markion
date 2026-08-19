import React, { useRef, useEffect, useImperativeHandle, forwardRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { selectAll } from "@codemirror/commands";
import { createEditorState, setLivePreview, setEditorMode, setFocusMode } from "./codemirror";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import { useI18n } from "../lib/i18n";
import { setEditorView } from "./registry";
import { ContextMenu } from "../components/ContextMenu";

/** Run a context-menu edit action. selectAll is a real CM6 command; cut/copy/
 *  paste go through the browser clipboard (execCommand) after focusing the
 *  view, which routes through CM6's input pipeline. */
function runEditCommand(view: EditorView, id: string): void {
  view.focus();
  if (id === "selectAll") {
    selectAll(view);
    return;
  }
  try {
    document.execCommand(id);
  } catch {
    // clipboard unavailable (e.g. jsdom) - ignore
  }
}

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
    const focusMode = useUiStore((s) => s.focusMode);
    const t = useI18n();
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
    const [menuView, setMenuView] = useState<EditorView | null>(null);

    useEffect(() => {
      if (!containerRef.current) return;
      const state = createEditorState(doc, (newDoc) => {
        onChangeRef.current?.(newDoc);
      }, {
        livePreview,
        onStateChange: (s) => onStateChangeRef.current?.(s),
        markdownContext:
          vaultRoot && docRel ? { vaultRoot, docRel } : undefined,
        onEditorContextMenu: (x, y, view) => {
          setMenu({ x, y });
          setMenuView(view);
        },
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

    // Focus mode (active-line highlight + typewriter centering).
    useEffect(() => {
      if (viewRef.current) setFocusMode(viewRef.current, focusMode);
    }, [focusMode]);

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
        {menu && menuView && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={[
              { id: "cut", label: t.cut },
              { id: "copy", label: t.copy },
              { id: "paste", label: t.paste },
              { id: "selectAll", label: t.selectAll },
            ]}
            onPick={(id) => {
              runEditCommand(menuView, id);
              setMenu(null);
            }}
            onClose={() => setMenu(null)}
          />
        )}
      </div>
    );
  },
);
