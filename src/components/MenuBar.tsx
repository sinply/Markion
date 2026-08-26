import React, { useEffect, useRef, useState } from "react";
import { useUiStore } from "../stores/uiStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useVaultStore } from "../stores/vaultStore";
import type { MarkdownCommand } from "../editor/commands";
import { useI18n, THEME_LABELS } from "../lib/i18n";
import { openNote } from "../lib/openNote";
import { docTitle } from "../lib/docTitle";
import { exportActiveNote } from "../lib/exportNote";
import type { Theme } from "../lib/types";

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
  const barRef = useRef<HTMLDivElement>(null);

  const ui = useUiStore();
  const settings = useSettingsStore();
  const vaultStore = useVaultStore();
  const t = useI18n();
  const theme = settings.theme;
  const language = settings.language;
  const mode = ui.editorMode;
  const focusMode = ui.focusMode;

  const close = () => setOpen(null);

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
    label: t.theme,
    items: (Object.keys(THEME_LABELS[language]) as Theme[]).map((val) => ({
      label: THEME_LABELS[language][val],
      checked: theme === val,
      action: () => {
        settings.setTheme(val);
        close();
      },
    })),
  };

  const languageSubmenu: Menu = {
    label: t.language,
    items: [
      { label: "中文", checked: language === "zh", action: () => { settings.setLanguage("zh"); close(); } },
      { label: "English", checked: language === "en", action: () => { settings.setLanguage("en"); close(); } },
    ],
  };

  const formatMenu: Menu = {
    label: t.format,
    items: [
      {
        label: t.formatInline,
        submenu: {
          label: t.formatInline,
          items: [
            md("bold", t.bold, "Ctrl+B"),
            md("italic", t.italic, "Ctrl+I"),
            md("strike", t.strikethrough),
            md("code", t.inlineCode),
          ],
        },
      },
      {
        label: t.formatBlocks,
        submenu: {
          label: t.formatBlocks,
          items: [
            md("heading1", t.heading1, "Ctrl+1"),
            md("heading2", t.heading2, "Ctrl+2"),
            md("heading3", t.heading3, "Ctrl+3"),
            md("codeblock", t.codeBlock),
            md("table", t.table),
            md("quote", t.blockquote),
          ],
        },
      },
      {
        label: t.formatLists,
        submenu: {
          label: t.formatLists,
          items: [
            md("bullet", t.bulletList),
            md("ordered", t.numberedList),
            md("task", t.taskList),
          ],
        },
      },
      {
        label: t.formatInsert,
        submenu: {
          label: t.formatInsert,
          items: [md("link", t.link), md("image", t.image)],
        },
      },
    ],
  };

  const menus: Menu[] = [
    {
      label: t.menuFile,
      items: [
        { label: t.openFolder, shortcut: "Ctrl+Shift+O", action: () => { ui.requestOpenFolder(); close(); } },
        { label: t.openFile, shortcut: "Ctrl+O", action: () => { ui.requestOpenFile(); close(); } },
        { label: t.save, shortcut: "Ctrl+S", action: () => { ui.requestSave(); close(); } },
        { label: t.saveAs, shortcut: "Ctrl+Shift+S", action: () => { ui.requestSaveAs(); close(); } },
        {
          label: t.saveAsExport,
          submenu: {
            label: t.saveAsExport,
            items: [
              { label: t.exportHtml, action: () => { void exportActiveNote(true); close(); } },
              { label: t.exportMarkdown, action: () => { void exportActiveNote(false); close(); } },
              { label: t.exportPdf, action: () => { void import("../lib/exportNote").then((m) => m.exportActivePdfFile()); close(); } },
              { label: t.exportImage, action: () => { void import("../lib/exportNote").then((m) => m.exportActiveImage()); close(); } },
            ],
          },
          separatorAfter: true },
        ...(settings.showDailyNote
          ? [{
              label: t.newDailyNote,
              action: () => {
                const root = vaultStore.vaultRoot;
                if (root) void import("../lib/templates").then((m) => m.openDailyNote(root));
                close();
              },
            }]
          : []),
        { label: t.insertTemplate, action: () => { ui.setTemplatesOpen(true); close(); }, separatorAfter: true },
        {
          label: t.vaults,
          submenu: {
            label: t.vaults,
            items: [
              ...vaultStore.recentVaults.map((v) => ({
                label: v === vaultStore.vaultRoot ? `✓ ${v}` : v,
                action: () => {
                  void vaultStore.switchVault(v);
                  close();
                },
              })),
              { label: t.vaultsManage, action: () => { ui.setVaultsOpen(true); close(); } },
              { label: t.openFolder, action: () => { ui.requestOpenFolder(); close(); } },
            ],
          },
          separatorAfter: true,
        },
        { label: t.setDefaultVault, action: () => { vaultStore.setAsDefault(); close(); }, separatorAfter: true },
        { label: t.preferences, action: () => { ui.setSettingsOpen(true); close(); }, separatorAfter: true },
        // Recent files live one level down so the top-level menu stays short.
        // Only entries from the CURRENT vault are offered — a stale path from
        // another vault used to resolve against this root and open the wrong
        // (or a nonexistent) file.
        ...(ui.recentFiles.filter((e) => e.vaultRoot === vaultStore.vaultRoot).length > 0
          ? [{
              label: t.recent,
              submenu: {
                label: t.recent,
                items: [
                  ...ui.recentFiles
                    .filter((e) => e.vaultRoot === vaultStore.vaultRoot)
                    .slice(0, 8)
                    .map((e) => ({
                      label: docTitle(e.path),
                      action: () => {
                        const root = vaultStore.vaultRoot;
                        if (root) void openNote(root, e.path);
                        close();
                      },
                    })),
                  { label: t.clearRecent, action: () => { ui.clearRecent(); close(); } },
                ],
              },
            }]
          : []),
        { label: t.exit, action: () => { window.close(); close(); } },
      ],
    },
    {
      label: t.menuEdit,
      items: [
        { label: t.undo, shortcut: "Ctrl+Z", action: () => { ui.requestEdit("undo"); close(); } },
        { label: t.redo, shortcut: "Ctrl+Y", action: () => { ui.requestEdit("redo"); close(); }, separatorAfter: true },
        { label: t.find, shortcut: t.findShortcut, action: () => { ui.requestEdit("find"); close(); } },
        { label: t.findInVault, shortcut: t.findInVaultShortcut, action: () => { ui.setSearchOpen(true); close(); }, separatorAfter: true },
        { label: t.cut, shortcut: "Ctrl+X", action: () => { ui.requestEdit("cut"); close(); } },
        { label: t.copy, shortcut: "Ctrl+C", action: () => { ui.requestEdit("copy"); close(); } },
        { label: t.paste, shortcut: "Ctrl+V", action: () => { ui.requestEdit("paste"); close(); } },
        { label: t.selectAll, shortcut: "Ctrl+A", action: () => { ui.requestEdit("selectAll"); close(); } },
      ],
    },
    formatMenu,
    {
      label: t.menuView,
      items: [
        {
          label: t.focusMode,
          shortcut: "Ctrl+Shift+L",
          checked: focusMode,
          action: () => { ui.setFocusMode(!focusMode); close(); },
          separatorAfter: true,
        },
        { label: t.theme, submenu: themeSubmenu },
        { label: t.language, submenu: languageSubmenu },
      ],
    },
    {
      label: t.menuHelp,
      items: [
        { label: t.documentation, shortcut: "F1", action: () => { ui.setHelpOpen(true); close(); } },
        { label: t.shortcuts, action: () => { ui.setShortcutsOpen(true); close(); }, separatorAfter: true },
        { label: t.about, action: () => { ui.setAboutOpen(true); close(); } },
      ],
    },
  ];

  const renderItems = (items: MenuItem[]) =>
    items.map((item, i) => (
      <div key={i}>
        {item.separatorAfter && <div className="markion-menu-sep" />}
        {item.submenu ? (
          <Submenu key={i} item={item} render={renderItems} />
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
            onClick={() => setOpen(open === menu.label ? null : menu.label)}
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

/** Hover-driven nested submenu; each level manages its own open state, so
 *  arbitrary nesting (Format → Inline → Bold) works without collisions. */
function Submenu({ item, render }: { item: MenuItem; render: (i: MenuItem[]) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="markion-menu-sub" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button className="markion-menu-item">
        <span className="markion-menu-check" />
        <span className="markion-menu-label">{item.label}</span>
        <span className="markion-menu-shortcut">▸</span>
      </button>
      {open && (
        <div className="markion-menu markion-submenu">{render(item.submenu!.items)}</div>
      )}
    </div>
  );
}
