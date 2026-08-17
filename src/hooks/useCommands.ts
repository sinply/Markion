import { useEffect } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useUiStore } from "../stores/uiStore";
import { useVaultStore } from "../stores/vaultStore";
import { useDocStore } from "../stores/docStore";
import { useSettingsStore } from "../stores/settingsStore";
import { writeFileAtomic } from "../lib/ipc";
import { openNote } from "../lib/openNote";
import { getEditorView } from "../editor/registry";
import { runMarkdownCommand, type MarkdownCommand } from "../editor/commands";
import { openSearchPanel } from "@codemirror/search";
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
      await openNote(root, rel);
    })();
  }, [ui.openFileTick]);

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
    } else if (cmd === "find") {
      openSearchPanel(view);
    } else if (cmd === "selectAll") {
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    } else if (cmd === "copy" || cmd === "cut") {
      // navigator.clipboard replaces the deprecated document.execCommand;
      // cut also deletes the selection from the document.
      const sel = view.state.selection.main;
      const text = view.state.sliceDoc(sel.from, sel.to);
      if (text) {
        void navigator.clipboard.writeText(text).catch(() => {});
      }
      if (cmd === "cut" && sel.from !== sel.to) {
        view.dispatch({ changes: { from: sel.from, to: sel.to } });
      }
    } else if (cmd === "paste") {
      void navigator.clipboard.readText().then((text) => {
        if (!text) return;
        const { from, to } = view.state.selection.main;
        view.dispatch({ changes: { from, to, insert: text } });
      }).catch(() => {});
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

  // Keyboard shortcuts. Listeners are attached once and read fresh state via
  // getState() so UI-store changes don't re-attach them on every tick.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip IME composition events (e.g. Chinese pinyin input): the key
      // pressed is part of the composition, not a shortcut.
      if (e.isComposing || e.keyCode === 229) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (e.shiftKey || e.altKey) return;
      if (k === "s") {
        e.preventDefault();
        void saveActive(false);
      } else if (k === "o") {
        e.preventDefault();
        useUiStore.getState().requestOpenFile();
      } else if (k === "e") {
        e.preventDefault();
        const { editorMode } = useUiStore.getState();
        useUiStore.getState().setEditorMode(editorMode === "live" ? "preview" : "live");
      } else if (k === "b") {
        e.preventDefault();
        useUiStore.getState().requestMarkdown("bold");
      } else if (k === "i") {
        e.preventDefault();
        useUiStore.getState().requestMarkdown("italic");
      } else if (k === "1" || k === "2" || k === "3") {
        e.preventDefault();
        const cmd = k === "1" ? "heading1" : k === "2" ? "heading2" : "heading3";
        useUiStore.getState().requestMarkdown(cmd as MarkdownCommand);
      } else if (k === "w") {
        e.preventDefault();
        // close the active tab
        const id = useDocStore.getState().activeDocId;
        if (id) useDocStore.getState().closeDoc(id);
      } else if (k === "f") {
        // Ctrl+F: focus the editor and open the CM6 search panel. When focus
        // is already in the editor, its own keymap handled the key (and
        // preventDefault'ed it) - respect that and do nothing.
        if (e.defaultPrevented) return;
        e.preventDefault();
        const view = getEditorView();
        if (view) {
          void openSearchPanel(view);
          view.focus();
        }
      }
    };
    const shiftHandler = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void saveActive(true);
      } else if (k === "o") {
        e.preventDefault();
        useUiStore.getState().requestOpenFolder();
      } else if (k === "e") {
        e.preventDefault();
        const { editorMode } = useUiStore.getState();
        useUiStore.getState().setEditorMode(editorMode === "live" ? "preview" : "live");
      } else if (k === "f") {
        // Ctrl+Shift+F: vault-wide full-text search (toggle)
        e.preventDefault();
        useUiStore.getState().setSearchOpen(!useUiStore.getState().searchOpen);
      }
    };
    const helpHandler = (e: KeyboardEvent) => {
      if (e.key === "F1") {
        e.preventDefault();
        useUiStore.getState().setHelpOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keydown", shiftHandler);
    window.addEventListener("keydown", helpHandler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keydown", shiftHandler);
      window.removeEventListener("keydown", helpHandler);
    };
  }, []);

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
    docStore.markSaved(id, content);
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
