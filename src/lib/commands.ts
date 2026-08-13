import { useI18n, THEME_LABELS } from "./i18n";
import { useUiStore } from "../stores/uiStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { MarkdownCommand } from "../editor/commands";
import type { Theme, Language } from "./types";

type Dict = ReturnType<typeof useI18n>;

const ui = () => useUiStore.getState();
const settings = () => useSettingsStore.getState();

export interface Command {
  id: string;
  title: string;
  keywords?: string[];
  shortcut?: string;
  run: () => void;
}

export async function createAndOpenNote(name: string): Promise<void> {
  const { useVaultStore } = await import("../stores/vaultStore");
  const { useDocStore } = await import("../stores/docStore");
  const { useUiStore } = await import("../stores/uiStore");
  const { createFile, readFile } = await import("./ipc");
  const root = useVaultStore.getState().vaultRoot;
  if (!root) return;
  const active = useDocStore.getState().openDocs.find(
    (d) => d.id === useDocStore.getState().activeDocId,
  );
  const docDir = active && active.path.includes("/")
    ? active.path.slice(0, active.path.lastIndexOf("/"))
    : "";
  const newPath = name.includes("/") ? `${name}.md` : docDir ? `${docDir}/${name}.md` : `${name}.md`;
  try {
    await createFile(root, newPath);
    await useVaultStore.getState().loadTree(root);
    const content = await readFile(root, newPath);
    const title = newPath.split("/").pop() ?? newPath;
    useDocStore.getState().openDoc(title, newPath);
    useDocStore.getState().setActiveContent(content);
    useUiStore.getState().addRecent(newPath);
  } catch {
    // creation failed — keep the palette closed, editor unchanged
  }
}

/** Build the full command list for the palette, localized with `t`. */
export function buildCommands(t: Dict): Command[] {
  const md = (cmd: MarkdownCommand, title: string, shortcut?: string): Command => ({
    id: `md:${cmd}`,
    title,
    shortcut,
    run: () => ui().requestMarkdown(cmd),
  });
  const edit = (cmd: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll", title: string, shortcut?: string): Command => ({
    id: `edit:${cmd}`,
    title,
    shortcut,
    run: () => ui().requestEdit(cmd),
  });
  const lang = settings().language;
  const themeItems: Command[] = (Object.keys(THEME_LABELS.en) as Theme[]).map((theme) => ({
    id: `theme:${theme}`,
    title: `${t.theme}: ${THEME_LABELS[lang][theme]}`,
    keywords: [THEME_LABELS.en[theme], THEME_LABELS.zh[theme]],
    run: () => settings().setTheme(theme),
  }));
  const langItems: Command[] = (["en", "zh"] as Language[]).map((l) => ({
    id: `lang:${l}`,
    title: `${t.language}: ${l === "zh" ? "中文" : "English"}`,
    keywords: [l],
    run: () => settings().setLanguage(l),
  }));

  return [
    md("bold", t.bold, "Ctrl+B"),
    md("italic", t.italic, "Ctrl+I"),
    md("strike", t.strikethrough),
    md("code", t.inlineCode),
    md("heading1", t.heading1, "Ctrl+1"),
    md("heading2", t.heading2, "Ctrl+2"),
    md("heading3", t.heading3, "Ctrl+3"),
    md("codeblock", t.codeBlock),
    md("table", t.table),
    md("quote", t.blockquote),
    md("bullet", t.bulletList),
    md("ordered", t.numberedList),
    md("task", t.taskList),
    md("link", t.link),
    md("image", t.image),
    edit("undo", t.undo, "Ctrl+Z"),
    edit("redo", t.redo, "Ctrl+Y"),
    edit("cut", t.cut, "Ctrl+X"),
    edit("copy", t.copy, "Ctrl+C"),
    edit("paste", t.paste, "Ctrl+V"),
    edit("selectAll", t.selectAll, "Ctrl+A"),
    {
      id: "file:openFolder",
      title: t.openFolder,
      shortcut: "Ctrl+Shift+O",
      run: () => ui().requestOpenFolder(),
    },
    {
      id: "file:openFile",
      title: t.openFile,
      shortcut: "Ctrl+O",
      run: () => ui().requestOpenFile(),
    },
    {
      id: "file:save",
      title: t.save,
      shortcut: "Ctrl+S",
      run: () => ui().requestSave(),
    },
    {
      id: "file:saveAs",
      title: t.saveAs,
      shortcut: "Ctrl+Shift+S",
      run: () => ui().requestSaveAs(),
    },
    {
      id: "file:newNote",
      title: "New note",
      keywords: ["new", "create", "note"],
      run: () => {
        const name = window.prompt("Note name");
        if (name && name.trim()) void createAndOpenNote(name.trim());
      },
    },
    {
      id: "view:edit",
      title: t.editMode,
      shortcut: "Ctrl+E",
      run: () => ui().setEditorMode("live"),
    },
    {
      id: "view:preview",
      title: t.previewMode,
      shortcut: "Ctrl+Shift+E",
      run: () => ui().setEditorMode("preview"),
    },
    {
      id: "view:settings",
      title: t.preferences,
      run: () => ui().setSettingsOpen(true),
    },
    ...themeItems,
    ...langItems,
  ];
}
