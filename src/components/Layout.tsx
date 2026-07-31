import { useState, useCallback } from "react";
import { Panel, Group, Separator } from "react-resizable-panels";
import { FileTree } from "./FileTree";
import { EditorPane } from "./EditorPane";
import { OutlinePane } from "./Outline";
import { QuickOpen } from "./QuickOpen";
import { SettingsDialog } from "./SettingsDialog";
import { useDocStore } from "../stores/docStore";
import { readFile } from "../lib/ipc";
import { useVaultStore } from "../stores/vaultStore";
import { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";

export function Layout() {
  const [editorState, setEditorState] = useState<EditorState | null>(null);

  const handleJump = useCallback((from: number) => {
    // Jump cursor to heading position — accessed via global editor ref for simplicity
    const activeEl = document.querySelector(".cm-editor .cm-content") as HTMLElement | null;
    if (activeEl) {
      const view = EditorView.findFromDOM(activeEl);
      if (view) {
        view.dispatch({ selection: { anchor: from } });
        view.focus();
      }
    }
  }, []);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <Group orientation="horizontal" style={{ flex: 1 }}>
        <Panel defaultSize={20} minSize={12} maxSize={35}>
          <FileTree />
        </Panel>
        <Separator style={{ width: 3, background: "#e0e0e0" }} />
        <Panel defaultSize={55} minSize={30}>
          <EditorPane
            onHeadingsChange={setEditorState}
          />
        </Panel>
        <Separator style={{ width: 3, background: "#e0e0e0" }} />
        <Panel defaultSize={25} minSize={10} maxSize={35}>
          <OutlinePane state={editorState} onJump={handleJump} />
        </Panel>
      </Group>
      <QuickOpen />
      <SettingsDialog />
    </div>
  );
}
