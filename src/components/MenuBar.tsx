import React, { useEffect, useRef, useState } from "react";
import { useUiStore } from "../stores/uiStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { Theme } from "../lib/types";
import type { MarkdownCommand } from "../editor/commands";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System (follow OS)" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "sepia", label: "Sepia" },
  { value: "eye", label: "Eye-care" },
  { value: "nord", label: "Nord" },
  { value: "dracula", label: "Dracula" },
  { value: "solarized", label: "Solarized" },
];

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  checked?: boolean;
  submenu?: Menu;
  separatorAfter?: boolean;
}

interface Menu {
  label: string;
  items: MenuItem[];
}

export function MenuBar() {
  const [open, setOpen] = useState<string | null>(null);
  const [subOpen, setSubOpen] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const ui = useUiStore();
  const settings = useSettingsStore();
  const theme = settings.theme;
  const mode = ui.editorMode;

  const close = () => {
    setOpen(null);
    setSubOpen(null);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) close();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const md = (cmd: MarkdownCommand, label: string, shortcut?: string): MenuItem => ({
    label,
    shortcut,
    action: () => {
      ui.requestMarkdown(cmd);
      close();
    },
  });

  const themeSubmenu: Menu = {
    label: "Theme",
    items: THEMES.map((t) => ({
      label: t.label,
      checked: theme === t.value,
      action: () => {
        settings.setTheme(t.value);
        close();
      },
    })),
  };

  const formatMenu: Menu = {
    label: "Format",
    items: [
      {
        label: "Inline",
        submenu: {
          label: "Inline",
          items: [
            md("bold", "Bold", "Ctrl+B"),
            md("italic", "Italic", "Ctrl+I"),
            md("strike", "Strikethrough"),
            md("code", "Inline Code"),
          ],
        },
      },
      {
        label: "Blocks",
        submenu: {
          label: "Blocks",
          items: [
            md("heading1", "Heading 1", "Ctrl+1"),
            md("heading2", "Heading 2", "Ctrl+2"),
            md("heading3", "Heading 3", "Ctrl+3"),
            md("codeblock", "Code Block"),
            md("table", "Table"),
            md("quote", "Blockquote"),
          ],
        },
      },
      {
        label: "Lists",
        submenu: {
          label: "Lists",
          items: [
            md("bullet", "Bullet List"),
            md("ordered", "Numbered List"),
            md("task", "Task List"),
          ],
        },
      },
      {
        label: "Insert",
        submenu: {
          label: "Insert",
          items: [md("link", "Link"), md("image", "Image")],
        },
      },
    ],
  };

  const menus: Menu[] = [
    {
      label: "File",
      items: [
        { label: "Open Folder…", shortcut: "Ctrl+Shift+O", action: () => { ui.requestOpenFolder(); close(); } },
        { label: "Open File…", shortcut: "Ctrl+O", action: () => { ui.requestOpenFile(); close(); } },
        { label: "Save", shortcut: "Ctrl+S", action: () => { ui.requestSave(); close(); } },
        { label: "Save As…", shortcut: "Ctrl+Shift+S", action: () => { ui.requestSaveAs(); close(); }, separatorAfter: true },
        { label: "Preferences…", action: () => { ui.setSettingsOpen(true); close(); }, separatorAfter: true },
        { label: "Recent", action: () => close(), separatorAfter: true },
        ...ui.recentFiles.slice(0, 5).map((p, i) => ({
          label: `  ${p}`,
          action: () => {
            void openRecentPath(p);
            close();
          },
        })),
        { label: "Clear Recent", action: () => { ui.clearRecent(); close(); }, separatorAfter: true },
        { label: "Exit", action: () => { window.close(); close(); } },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", shortcut: "Ctrl+Z", action: () => { ui.requestEdit("undo"); close(); } },
        { label: "Redo", shortcut: "Ctrl+Y", action: () => { ui.requestEdit("redo"); close(); }, separatorAfter: true },
        { label: "Cut", shortcut: "Ctrl+X", action: () => { ui.requestEdit("cut"); close(); } },
        { label: "Copy", shortcut: "Ctrl+C", action: () => { ui.requestEdit("copy"); close(); } },
        { label: "Paste", shortcut: "Ctrl+V", action: () => { ui.requestEdit("paste"); close(); } },
        { label: "Select All", shortcut: "Ctrl+A", action: () => { ui.requestEdit("selectAll"); close(); }, separatorAfter: true },
        { label: "Format", submenu: formatMenu },
      ],
    },
    {
      label: "View",
      items: [
        {
          label: "Edit Mode",
          shortcut: "Ctrl+E",
          checked: mode === "live",
          action: () => { ui.setEditorMode("live"); close(); },
        },
        {
          label: "Preview Mode",
          shortcut: "Ctrl+Shift+E",
          checked: mode === "preview",
          action: () => { ui.setEditorMode("preview"); close(); },
          separatorAfter: true,
        },
        { label: "Theme", submenu: themeSubmenu },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "About Markion", action: () => { ui.setAboutOpen(true); close(); } },
      ],
    },
  ];

  const renderItems = (items: MenuItem[]) =>
    items.map((item, i) => (
      <div key={i}>
        {item.separatorAfter && <div className="markion-menu-sep" />}
        {item.submenu ? (
          <SubmenuItem key={i} item={item} open={subOpen} onOpen={setSubOpen} render={renderItems} />
        ) : (
          <button
            className={`markion-menu-item${item.checked ? " checked" : ""}`}
            onClick={item.action}
          >
            <span className="markion-menu-check">{item.checked ? "✓" : ""}</span>
            <span className="markion-menu-label">{item.label}</span>
            {item.shortcut && <span className="markion-menu-shortcut">{item.shortcut}</span>}
          </button>
        )}
      </div>
    ));

  return (
    <div ref={barRef} className="markion-menubar" onMouseLeave={() => setOpen(null)}>
      {menus.map((menu) => (
        <div key={menu.label} className="markion-menubar-item">
          <button
            className="markion-menubar-btn"
            onClick={() => {
              if (open === menu.label) {
                close();
              } else {
                setOpen(menu.label);
                setSubOpen(null);
              }
            }}
          >
            {menu.label}
          </button>
          {open === menu.label && (
            <div className="markion-menu">{renderItems(menu.items)}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function SubmenuItem({
  item,
  open,
  onOpen,
  render,
}: {
  item: MenuItem;
  open: string | null;
  onOpen: (k: string | null) => void;
  render: (items: MenuItem[]) => React.ReactNode;
}) {
  const label = item.submenu!.label;
  return (
    <div className="markion-menu-sub">
      <button className="markion-menu-item" onClick={() => onOpen(open === label ? null : label)}>
        <span className="markion-menu-check" />
        <span className="markion-menu-label">{item.label}</span>
        <span className="markion-menu-shortcut">▸</span>
      </button>
      {open === label && (
        <div className="markion-menu markion-submenu">{render(item.submenu!.items)}</div>
      )}
    </div>
  );
}

// helper used in menu actions — opens a recent path (assumes it's inside the active vault)
async function openRecentPath(path: string) {
  const { useVaultStore } = await import("../stores/vaultStore");
  const { useDocStore } = await import("../stores/docStore");
  const { readFile } = await import("../lib/ipc");
  const vaultRoot = useVaultStore.getState().vaultRoot;
  if (!vaultRoot) return;
  try {
    const content = await readFile(vaultRoot, path);
    const title = path.split("/").pop() ?? path;
    useDocStore.getState().openDoc(title, path);
    useDocStore.getState().setActiveContent(content);
  } catch {
    // ignore read errors
  }
}
