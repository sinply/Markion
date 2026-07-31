import { useState, useCallback } from "react";
import { Panel, Group, Separator } from "react-resizable-panels";
import { FileTree } from "./FileTree";
import { EditorPane } from "./EditorPane";
import { OutlinePane } from "./Outline";
import { QuickOpen } from "./QuickOpen";
import { SettingsDialog } from "./SettingsDialog";
import { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";

export function Layout() {
  const [editorState, setEditorState] = useState<EditorState | null>(null);

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
        // ignore — best-effort scroll
      }
    }, 20);
  }, []);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <Group orientation="horizontal" style={{ flex: 1 }} id="main">
        <Panel id="tree" defaultSize="20" minSize="12" maxSize="35">
          <FileTree />
        </Panel>
        <Separator id="sep-tree" style={{ width: 3, background: "#e0e0e0" }} />
        <Panel id="editor" defaultSize="55" minSize="30">
          <EditorPane onHeadingsChange={setEditorState} />
        </Panel>
        <Separator id="sep-outline" style={{ width: 3, background: "#e0e0e0" }} />
        <Panel id="outline" defaultSize="25" minSize="10" maxSize="35">
          <OutlinePane state={editorState} onJump={handleJump} />
        </Panel>
      </Group>
      <QuickOpen />
      <SettingsDialog />
    </div>
  );
}
