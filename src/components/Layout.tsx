import { useState, useCallback, useEffect, useRef } from "react";
import { Panel, Group, Separator, type Layout as PanelLayout } from "react-resizable-panels";
import { FileTree } from "./FileTree";
import { EditorPane } from "./EditorPane";
import { OutlinePane } from "./Outline";
import { BacklinksPanel } from "./BacklinksPanel";
import { GraphPanel } from "./GraphPanel";
import { TagsPanel } from "./TagsPanel";
import { CommandPalette } from "./CommandPalette";
import { LibraryHome } from "./LibraryHome";
import { FolderTableDialog } from "./FolderTableDialog";
import { useSettingsStore } from "../stores/settingsStore";
import { useWikiIndex } from "../hooks/useWikiIndex";
import { useUiStore } from "../stores/uiStore";
import { useDocStore } from "../stores/docStore";
import { useVaultStore } from "../stores/vaultStore";
import { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";

const LAYOUT_KEY = "markion.layout";

function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable - layout just won't persist
  }
}

/** Small chevron button used to collapse/expand side panels. */
function chevron(label: string, title: string, onClick: () => void, style?: React.CSSProperties) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: "none",
        border: "1px solid var(--border)",
        borderRadius: 4,
        color: "var(--fg-muted)",
        cursor: "pointer",
        fontSize: 11,
        lineHeight: 1,
        padding: "3px 6px",
        ...style,
      }}
    >
      {label}
    </button>
  );
}

export function Layout() {
  useWikiIndex();
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const showOutline = useSettingsStore((s) => s.showOutline);
  const showBacklinks = useSettingsStore((s) => s.showBacklinks);
  const showGraph = useSettingsStore((s) => s.showGraph);
  const showTags = useSettingsStore((s) => s.showTags);
  const rightHasContent = showOutline || showBacklinks || showGraph || showTags;

  // Panel sizes persist across sessions (workspaces-lite) via the group layout.
  const [layout, setLayout] = useState<PanelLayout | null>(() => loadJson<PanelLayout>(LAYOUT_KEY));
  // Side panels always START expanded; collapsing is session-only. Persisting
  // it made a single accidental click hide the sidebar on every launch.
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const handleJump = useCallback((from: number) => {
    const activeEl = document.querySelector(".cm-editor .cm-content") as HTMLElement | null;
    if (!activeEl) return;
    const view = EditorView.findFromDOM(activeEl);
    if (!view) return;
    view.dispatch({ selection: { anchor: from } });
    view.focus();
    // Center the target line manually. Use setTimeout (not rAF) so it works
    // even when the pane isn't actively compositing (rAF can be throttled).
    setTimeout(() => {
      try {
        const coords = view.coordsAtPos(from);
        if (!coords) return;
        const scroller = view.scrollDOM;
        const scrollerRect = scroller.getBoundingClientRect();
        const target = scroller.scrollTop + (coords.top - scrollerRect.top) - scroller.clientHeight / 2;
        scroller.scrollTop = Math.max(0, target);
      } catch {
        // ignore - best-effort scroll
      }
    }, 20);
  }, []);

  const toggleLeft = (collapsed: boolean) => {
    setLeftCollapsed(collapsed);
  };
  const toggleRight = (collapsed: boolean) => {
    setRightCollapsed(collapsed);
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", position: "relative" }}>
      <Group
        orientation="horizontal"
        style={{ flex: 1 }}
        id="main"
        defaultLayout={layout ?? undefined}
        onLayoutChanged={(l) => {
          setLayout(l);
          save(LAYOUT_KEY, JSON.stringify(l));
        }}
      >
        {!leftCollapsed && (
          <>
            <Panel id="tree" defaultSize="20" minSize="12" maxSize="35">
              <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
                <div style={{ padding: "4px 8px", display: "flex", justifyContent: "flex-end" }}>
                  {chevron("«", "Collapse sidebar", () => toggleLeft(true))}
                </div>
                <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
                  <FileTree />
                </div>
              </div>
            </Panel>
            <Separator id="sep-tree" style={{ width: 3, background: "var(--border)" }} />
          </>
        )}
        <Panel id="editor" defaultSize={leftCollapsed ? "100" : "55"} minSize="30">
          <EditorPane onHeadingsChange={setEditorState} />
        </Panel>
        {rightHasContent && !rightCollapsed && (
          <>
            <Separator id="sep-outline" style={{ width: 3, background: "var(--border)" }} />
            <Panel id="outline" defaultSize="25" minSize="10" maxSize="35">
              <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
                <div style={{ padding: "4px 8px", display: "flex", justifyContent: "flex-end" }}>
                  {chevron("»", "Collapse side panel", () => toggleRight(true))}
                </div>
                {showOutline && (
                  <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
                    <OutlinePane state={editorState} onJump={handleJump} />
                  </div>
                )}
                {showBacklinks && (
                  <div style={{ borderTop: "1px solid var(--border)" }}>
                    <BacklinksPanel />
                  </div>
                )}
                {showGraph && (
                  <div style={{ borderTop: "1px solid var(--border)" }}>
                    <GraphPanel />
                  </div>
                )}
                {showTags && (
                  <div style={{ borderTop: "1px solid var(--border)" }}>
                    <TagsPanel />
                  </div>
                )}
              </div>
            </Panel>
          </>
        )}
      </Group>
      {leftCollapsed &&
        chevron("»", "Expand sidebar", () => toggleLeft(false), {
          position: "absolute",
          left: 4,
          top: 30,
          zIndex: 5,
        })}
      {rightHasContent &&
        rightCollapsed &&
        chevron("«", "Expand side panel", () => toggleRight(false), {
          position: "absolute",
          right: 4,
          top: 30,
          zIndex: 5,
        })}
      <CommandPalette />
      <LibraryHome />
      <FolderTableDialog />
    </div>
  );
}
