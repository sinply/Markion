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
import { effectiveShortcuts, parseCombo, type Combo } from "../lib/shortcuts";

/** Execute a shortcut-command id (shared with the shortcuts dialog labels). */
function runShortcut(id: string): void {
  const uiStore = useUiStore.getState();
  switch (id) {
    case "app:save":
      void saveActive(false);
      break;
    case "app:saveAs":
      void saveActive(true);
      break;
    case "app:openFile":
      uiStore.requestOpenFile();
      break;
    case "app:openFolder":
      uiStore.requestOpenFolder();
      break;
    case "app:closeTab": {
      const docId = useDocStore.getState().activeDocId;
      if (docId) useDocStore.getState().closeDoc(docId);
      break;
    }
    case "app:find": {
      const view = getEditorView();
      if (view) {
        void openSearchPanel(view);
        view.focus();
      }
      break;
    }
    case "app:vaultSearch":
      uiStore.setSearchOpen(!uiStore.searchOpen);
      break;
    case "app:reopenTab": {
      const top = uiStore.takeRecentlyClosed();
      if (!top) break;
      void import("../stores/vaultStore").then((m) => {
        const root = m.useVaultStore.getState().vaultRoot;
        if (root) void import("../lib/openNote").then((mod) => mod.openNote(root, top.path));
      });
      break;
    }
    default:
      if (id.startsWith("md:")) {
        const cmd = id.slice(3);
        if (cmd === "bold" || cmd === "italic" || cmd === "heading1" ||
            cmd === "heading2" || cmd === "heading3") {
          uiStore.requestMarkdown(cmd as MarkdownCommand);
        }
      }
  }
}

/** Effective combo table (defaults + user overrides), rebuilt per keydown so
 *  config changes apply instantly. */
function combos(): { id: string; combo: Combo }[] {
  const overrides = useSettingsStore.getState().shortcuts;
  const out: { id: string; combo: Combo }[] = [];
  for (const [id, spec] of Object.entries(effectiveShortcuts(overrides))) {
    const combo = parseCombo(spec);
    if (combo) out.push({ id, combo });
  }
  return out;
}

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

  // Keyboard shortcuts, table-driven: the built-in bindings (shortcuts.ts)
  // plus any user overrides from settings. Listeners are attached once and
  // read fresh state via getState() so config changes apply without re-attach.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip IME composition events (e.g. Chinese pinyin input): the key
      // pressed is part of the composition, not a shortcut.
      if (e.isComposing || e.keyCode === 229) return;
      const key = e.key.toLowerCase();
      for (const { id, combo } of combos()) {
        if (
          e.ctrlKey === combo.ctrl &&
          e.shiftKey === combo.shift &&
          e.altKey === combo.alt &&
          key === combo.key
        ) {
          // Ctrl+F: when focus is inside the editor, CM6's own keymap already
          // handled the key (and preventDefault'ed it) - respect that.
          if (id === "app:find" && e.defaultPrevented) return;
          e.preventDefault();
          runShortcut(id);
          return;
        }
      }
    };
    const helpHandler = (e: KeyboardEvent) => {
      if (e.key === "F1") {
        e.preventDefault();
        useUiStore.getState().setHelpOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keydown", helpHandler);
    return () => {
      window.removeEventListener("keydown", handler);
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
