import { useEffect, useRef, useState } from "react";
import { useUiStore } from "../stores/uiStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { Theme } from "../lib/types";

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

interface Menu {
  label: string;
  items: {
    label: string;
    shortcut?: string;
    action: () => void;
    checked?: boolean;
    separatorAfter?: boolean;
  }[];
}

export function MenuBar() {
  const [open, setOpen] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const ui = useUiStore();
  const settings = useSettingsStore();
  const theme = settings.theme;
  const mode = ui.editorMode;

  const close = () => setOpen(null);

  // close when clicking outside
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) close();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const menus: Menu[] = [
    {
      label: "File",
      items: [
        { label: "Open Folder…", shortcut: "Ctrl+Shift+O", action: () => { ui.requestOpenFolder(); close(); } },
        { label: "Open File…", shortcut: "Ctrl+O", action: () => { ui.requestOpenFile(); close(); } },
        { label: "Save", shortcut: "Ctrl+S", action: () => { ui.requestSave(); close(); } },
        { label: "Save As…", shortcut: "Ctrl+Shift+S", action: () => { ui.requestSaveAs(); close(); } },
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
        ...THEMES.map((t) => ({
          label: t.label,
          checked: theme === t.value,
          action: () => { settings.setTheme(t.value); close(); },
        })),
      ],
    },
    {
      label: "Settings",
      items: [
        { label: "Preferences…", action: () => { ui.setSettingsOpen(true); close(); } },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "About Markion", action: () => { ui.setAboutOpen(true); close(); } },
      ],
    },
  ];

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
            <div className="markion-menu">
              {menu.items.map((item, i) => (
                <div key={i}>
                  {item.separatorAfter && <div className="markion-menu-sep" />}
                  <button
                    className={`markion-menu-item${item.checked ? " checked" : ""}`}
                    onClick={item.action}
                  >
                    <span className="markion-menu-check">{item.checked ? "✓" : ""}</span>
                    <span className="markion-menu-label">{item.label}</span>
                    {item.shortcut && <span className="markion-menu-shortcut">{item.shortcut}</span>}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
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
