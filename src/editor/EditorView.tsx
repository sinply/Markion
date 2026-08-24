import React, { useRef, useEffect, useImperativeHandle, forwardRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { selectAll } from "@codemirror/commands";
import { createEditorState, setLivePreview, setEditorMode, setFocusMode } from "./codemirror";
import { extractFrontmatter } from "../lib/frontmatter";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import { useI18n } from "../lib/i18n";
import { setEditorView } from "./registry";
import { ContextMenu } from "../components/ContextMenu";

/** A freshly opened note puts the cursor at position 0 — inside the
 *  frontmatter, which would show raw YAML instead of the Properties card.
 *  When the passive cursor sits in the frontmatter block, move it just past
 *  the block so the note opens on its rendered body. An explicit user click
 *  into the card still reveals the YAML (cursorInside rule in livePreview). */
export function skipFrontmatterCursor(view: EditorView): void {
  const fm = extractFrontmatter(view.state.doc.toString());
  if (!fm) return;
  const head = view.state.selection.main.head;
  if (head < fm.end) {
    view.dispatch({ selection: { anchor: Math.min(fm.end, view.state.doc.length) } });
  }
}

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
      skipFrontmatterCursor(view);
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
        skipFrontmatterCursor(view);
      },
      get view() {
        return viewRef.current;
      },
    }));

    return (
      <div style={{ position: "relative", height: "100%" }}>
        <div ref={containerRef} className="markdown-editor" style={{ height: "100%" }} />
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
