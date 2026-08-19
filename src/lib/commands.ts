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
    md("toc", t.toc),
    md("tableFormat", t.tableFormat),
    edit("undo", t.undo, "Ctrl+Z"),
    edit("redo", t.redo, "Ctrl+Y"),
    edit("cut", t.cut, "Ctrl+X"),
    edit("copy", t.copy, "Ctrl+C"),
    edit("paste", t.paste, "Ctrl+V"),
    edit("selectAll", t.selectAll, "Ctrl+A"),
    {
      id: "edit:find",
      title: t.find,
      shortcut: t.findShortcut,
      keywords: ["search", "查找"],
      run: () => ui().requestEdit("find"),
    },
    {
      id: "search:vault",
      title: t.findInVault,
      shortcut: t.findInVaultShortcut,
      keywords: ["search", "full text", "全文", "查找"],
      run: () => ui().setSearchOpen(true),
    },
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
      id: "file:exportHtml",
      title: t.exportHtml,
      keywords: ["export", "html", "导出"],
      run: () => {
        void import("./exportNote").then((m) => m.exportActiveNote(true));
      },
    },
    {
      id: "file:exportMarkdown",
      title: t.exportMarkdown,
      keywords: ["export", "markdown", "md", "导出"],
      run: () => {
        void import("./exportNote").then((m) => m.exportActiveNote(false));
      },
    },
    {
      id: "file:exportPdf",
      title: t.exportPdf,
      keywords: ["export", "pdf", "print", "导出", "打印"],
      run: () => {
        void import("./exportNote").then((m) => m.exportActivePdf());
      },
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
      id: "note:daily",
      title: t.newDailyNote,
      keywords: ["daily", "today", "journal", "每日", "日记"],
      run: () => {
        void import("../stores/vaultStore").then((m) => {
          const root = m.useVaultStore.getState().vaultRoot;
          if (root) void import("./templates").then((mod) => mod.openDailyNote(root));
        });
      },
    },
    {
      id: "file:reopenClosed",
      title: t.reopenClosed,
      shortcut: "Ctrl+Shift+T",
      keywords: ["reopen", "closed", "tab", "恢复", "关闭", "标签"],
      run: () => {
        const top = ui().takeRecentlyClosed();
        if (!top) return;
        void import("../stores/vaultStore").then((m) => {
          const root = m.useVaultStore.getState().vaultRoot;
          if (root) void import("./openNote").then((mod) => mod.openNote(root, top.path));
        });
      },
    },
    {
      id: "view:fullscreen",
      title: t.fullscreen,
      keywords: ["fullscreen", "zen", "禅", "全屏"],
      run: () => {
        void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
          try {
            const win = getCurrentWindow();
            await win.setFullscreen(!(await win.isFullscreen()));
          } catch {
            // window API unavailable (web build) - ignore
          }
        });
      },
    },
    {
      id: "template:insert",
      title: t.insertTemplate,
      keywords: ["template", "insert", "模板", "插入"],
      run: () => ui().setTemplatesOpen(true),
    },
    {
      id: "note:properties",
      title: t.editProperties,
      keywords: ["properties", "frontmatter", "meta", "yaml", "属性", "元数据"],
      run: () => ui().setPropertiesOpen(true),
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
      shortcut: "Ctrl+Shift+E",      run: () => ui().setEditorMode("preview"),
    },
    {
      id: "view:focus",
      title: t.focusMode,
      shortcut: "Ctrl+Shift+L",
      keywords: ["focus", "typewriter", "聚焦", "打字机"],
      run: () => ui().setFocusMode(!ui().focusMode),
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
