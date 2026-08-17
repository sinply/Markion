import { useUiStore } from "../stores/uiStore";
import { useSettingsStore } from "../stores/settingsStore";

export function ShortcutsDialog() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  const lang = useSettingsStore((s) => s.language);
  const isZh = lang === "zh";

  const groups: { title: string; items: [string, string][] }[] = isZh
    ? [
        { title: "文件", items: [
          ["Ctrl+O", "打开文件"], ["Ctrl+Shift+O", "打开文件夹"],
          ["Ctrl+S", "保存"], ["Ctrl+Shift+S", "另存为"],
        ]},
        { title: "编辑", items: [
          ["Ctrl+Z", "撤销"], ["Ctrl+Y", "重做"], ["Ctrl+X", "剪切"],
          ["Ctrl+C", "复制"], ["Ctrl+V", "粘贴"], ["Ctrl+A", "全选"],
          ["Ctrl+W", "关闭标签"], ["Ctrl+E", "编辑/预览切换"],
        ]},
        { title: "搜索", items: [
          ["Ctrl+F", "当前笔记内查找"], ["Ctrl+Shift+F", "全库搜索"],
        ]},
        { title: "格式", items: [
          ["Ctrl+B", "粗体"], ["Ctrl+I", "斜体"], ["Ctrl+1/2/3", "标题 1/2/3"],
        ]},
        { title: "其他", items: [
          ["Ctrl+P", "快速打开"], ["F1", "使用说明"],
        ]},
      ]
    : [
        { title: "File", items: [
          ["Ctrl+O", "Open file"], ["Ctrl+Shift+O", "Open folder"],
          ["Ctrl+S", "Save"], ["Ctrl+Shift+S", "Save as"],
        ]},
        { title: "Edit", items: [
          ["Ctrl+Z", "Undo"], ["Ctrl+Y", "Redo"], ["Ctrl+X", "Cut"],
          ["Ctrl+C", "Copy"], ["Ctrl+V", "Paste"], ["Ctrl+A", "Select all"],
          ["Ctrl+W", "Close tab"], ["Ctrl+E", "Toggle edit/preview"],
        ]},
        { title: "Search", items: [
          ["Ctrl+F", "Find in note"], ["Ctrl+Shift+F", "Search vault"],
        ]},
        { title: "Format", items: [
          ["Ctrl+B", "Bold"], ["Ctrl+I", "Italic"], ["Ctrl+1/2/3", "Heading 1/2/3"],
        ]},
        { title: "Other", items: [
          ["Ctrl+P", "Quick open"], ["F1", "Documentation"],
        ]},
      ];

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", top: "12%", left: "28%", width: "44%", maxHeight: "78%",
        background: "var(--bg)", boxShadow: "0 6px 30px rgba(0,0,0,0.3)", borderRadius: 10,
        zIndex: 3000, padding: 20, fontSize: 14, display: "flex", flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0, flex: 1 }}>{isZh ? "快捷键" : "Keyboard Shortcuts"}</h2>
        <button onClick={() => setOpen(false)} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 18, color: "var(--fg-muted)" }}>×</button>
      </div>
      <div style={{ overflow: "auto", flex: 1 }}>
        {groups.map((g) => (
          <div key={g.title} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{g.title}</div>
            {g.items.map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", lineHeight: 1.5 }}>
                <kbd style={{ background: "var(--panel-bg)", border: "1px solid var(--border)", borderRadius: 4, padding: "0 6px", fontSize: 12 }}>{k}</kbd>
                <span style={{ color: "var(--fg)" }}>{v}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <button onClick={() => setOpen(false)} style={{ padding: "6px 16px", marginTop: 12, cursor: "pointer" }}>
        {isZh ? "关闭" : "Close"}
      </button>
    </div>
  );
}
