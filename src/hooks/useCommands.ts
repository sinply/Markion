import { useEffect } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useUiStore } from "../stores/uiStore";
import { useVaultStore } from "../stores/vaultStore";
import { useDocStore } from "../stores/docStore";
import { useSettingsStore } from "../stores/settingsStore";
import { readFile, writeFileAtomic } from "../lib/ipc";
import { getEditorView } from "../editor/registry";
import { runMarkdownCommand } from "../editor/commands";
import { undo, redo } from "@codemirror/commands";

/** Wire menu-bar / keyboard commands to app actions. */
export function useCommands() {
  const ui = useUiStore();
  const loadTree = useVaultStore((s) => s.loadTree);
  const loadSettings = useSettingsStore((s) => s.load);

  // Open Folder
  useEffect(() => {
    if (ui.openFolderTick === 0) return;
    void (async () => {
      const folder = await open({ directory: true, multiple: false });
      if (typeof folder !== "string") return;
      await loadTree(folder);
      await loadSettings(folder);
      try {
        const { startVaultWatch } = await import("../lib/ipc");
        await startVaultWatch(folder);
      } catch {
        // non-fatal
      }
    })();
  }, [ui.openFolderTick, loadTree, loadSettings]);

  // Open File (within current vault)
  useEffect(() => {
    if (ui.openFileTick === 0) return;
    void (async () => {
      const root = useVaultStore.getState().vaultRoot;
      if (!root) return;
      const picked = await open({ directory: false, multiple: false, defaultPath: root });
      if (typeof picked !== "string") return;
      const rel = picked.startsWith(root.replace(/\\/g, "/"))
        ? picked.replace(root.replace(/\\/g, "/") + "/", "").replace(/\\/g, "/")
        : picked.split(/[\\/]/).pop() ?? picked;
      try {
        const content = await readFile(root, rel);
        const title = rel.split("/").pop() ?? rel;
        useDocStore.getState().openDoc(title, rel);
        useDocStore.getState().setActiveContent(content);
        ui.addRecent(rel);
      } catch {
        // ignore
      }
    })();
  }, [ui.openFileTick, ui.addRecent]);

  // Save
  useEffect(() => {
    if (ui.saveTick === 0) return;
    void saveActive(false);
  }, [ui.saveTick]);

  // Save As
  useEffect(() => {
    if (ui.saveAsTick === 0) return;
    void saveActive(true);
  }, [ui.saveAsTick]);

  // Edit operations (undo/redo/selectAll/copy/cut/paste)
  useEffect(() => {
    if (ui.editTick === 0) return;
    const view = getEditorView();
    if (!view) return;
    const cmd = ui.editCmd;
    if (cmd === "undo") {
      undo(view);
    } else if (cmd === "redo") {
      redo(view);
    } else if (cmd === "selectAll") {
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    } else {
      // copy / cut / paste via the browser clipboard
      const ok = document.execCommand(cmd === "paste" ? "paste" : cmd);
      if (!ok && cmd !== "paste") {
        const sel = view.state.selection.main;
        const text = view.state.sliceDoc(sel.from, sel.to);
        void navigator.clipboard.writeText(text);
      }
    }
    view.focus();
  }, [ui.editTick, ui.editCmd]);

  // Markdown formatting commands
  useEffect(() => {
    if (ui.mdTick === 0) return;
    const view = getEditorView();
    if (!view) return;
    runMarkdownCommand(view, ui.mdCmd);
    view.focus();
  }, [ui.mdTick, ui.mdCmd]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void saveActive(e.shiftKey);
      } else if (k === "o") {
        e.preventDefault();
        if (e.shiftKey) ui.requestOpenFolder();
        else ui.requestOpenFile();
      } else if (k === "e") {
        e.preventDefault();
        ui.setEditorMode(ui.editorMode === "live" ? "preview" : "live");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [ui]);

  return null;
}

async function saveActive(asNew: boolean) {
  const { useVaultStore } = await import("../stores/vaultStore");
  const { useDocStore } = await import("../stores/docStore");
  const { writeFileAtomic } = await import("../lib/ipc");
  const root = useVaultStore.getState().vaultRoot;
  const docStore = useDocStore.getState();
  const id = docStore.activeDocId;
  if (!root || !id) return;
  const doc = docStore.openDocs.find((d) => d.id === id);
  if (!doc) return;

  let targetRel = doc.path;
  if (asNew) {
    const picked = await save({
      defaultPath: root + "/" + doc.title,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (typeof picked !== "string") return;
    const rootNorm = root.replace(/\\/g, "/");
    const pickedNorm = picked.replace(/\\/g, "/");
    targetRel = pickedNorm.startsWith(rootNorm + "/")
      ? pickedNorm.slice(rootNorm.length + 1)
      : pickedNorm.split("/").pop() ?? doc.title;
  }

  const content = docStore.activeContent;
  try {
    await writeFileAtomic(root, targetRel, content);
    docStore.markClean(id);
    if (asNew) {
      docStore.openDoc(targetRel.split("/").pop() ?? targetRel, targetRel);
      docStore.setActiveContent(content);
      useUiStore.getState().addRecent(targetRel);
    } else {
      useUiStore.getState().addRecent(targetRel);
    }
  } catch {
    // save failed — stays dirty
  }
}
