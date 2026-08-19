import { useState } from "react";
import { useUiStore } from "../stores/uiStore";
import { useSettingsStore } from "../stores/settingsStore";
import { DEFAULT_SHORTCUTS, effectiveShortcuts } from "../lib/shortcuts";

const LABELS: Record<string, { en: string; zh: string }> = {
  "app:save": { en: "Save", zh: "保存" },
  "app:saveAs": { en: "Save as", zh: "另存为" },
  "app:openFile": { en: "Open file", zh: "打开文件" },
  "app:openFolder": { en: "Open folder", zh: "打开文件夹" },
  "md:bold": { en: "Bold", zh: "粗体" },
  "md:italic": { en: "Italic", zh: "斜体" },
  "md:heading1": { en: "Heading 1", zh: "标题 1" },
  "md:heading2": { en: "Heading 2", zh: "标题 2" },
  "md:heading3": { en: "Heading 3", zh: "标题 3" },
  "app:toggleMode": { en: "Toggle edit/preview", zh: "编辑/预览切换" },
  "app:closeTab": { en: "Close tab", zh: "关闭标签" },
  "app:find": { en: "Find in note", zh: "笔记内查找" },
  "app:vaultSearch": { en: "Search vault", zh: "全库搜索" },
  "app:reopenTab": { en: "Reopen closed tab", zh: "恢复关闭的标签" },
};

export function ShortcutsDialog() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  const lang = useSettingsStore((s) => s.language);
  const shortcuts = useSettingsStore((s) => s.shortcuts);
  const setShortcut = useSettingsStore((s) => s.setShortcut);
  const resetShortcuts = useSettingsStore((s) => s.resetShortcuts);
  const [err, setErr] = useState("");
  const isZh = lang === "zh";

  if (!open) return null;

  const effective = effectiveShortcuts(shortcuts);

  const edit = (id: string) => {
    const input = window.prompt(
      isZh
        ? `为「${LABELS[id].zh}」输入新快捷键（如 Ctrl+Shift+K；留空恢复默认）`
        : `New shortcut for "${LABELS[id].en}" (e.g. Ctrl+Shift+K; empty = default)`,
      effective[id],
    );
    if (input === null) return; // cancelled
    const trimmed = input.trim();
    setErr("");
    if (trimmed === "") {
      // Empty input = restore the built-in binding (storing the default is a
      // no-op override that reads identically through the effective merge).
      setShortcut(id, DEFAULT_SHORTCUTS[id]);
    } else if (!/^([\w]+(\+[\w]+)+|\w+)$/i.test(trimmed)) {
      setErr(isZh ? "无效的快捷键格式" : "Invalid shortcut format");
    } else {
      setShortcut(id, trimmed);
    }
  };

  const rows = Object.keys(DEFAULT_SHORTCUTS).map((id) => ({
    id,
    label: isZh ? LABELS[id].zh : LABELS[id].en,
    combo: effective[id],
  }));

  return (
    <div
      style={{
        position: "fixed", top: "10%", left: "30%", width: "40%", maxHeight: "80%",
        background: "var(--bg)", boxShadow: "0 6px 30px rgba(0,0,0,0.3)", borderRadius: 10,
        zIndex: 3000, padding: 20, fontSize: 14, display: "flex", flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <h2 style={{ margin: 0, flex: 1 }}>{isZh ? "快捷键" : "Keyboard Shortcuts"}</h2>
        <button onClick={() => setOpen(false)} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 18, color: "var(--fg-muted)" }}>×</button>
      </div>
      <div style={{ color: "var(--fg-muted)", fontSize: 12, marginBottom: 8 }}>
        {isZh ? "点击「修改」重新绑定（保存后立即生效，存于 vault 配置）。" : "Click a combo to rebind it (applies immediately, stored in the vault config)."}
      </div>
      {err && <div style={{ color: "#d73a49", fontSize: 13, marginBottom: 8 }}>{err}</div>}
      <div style={{ overflow: "auto", flex: 1 }}>
        {rows.map((r) => (
          <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", lineHeight: 1.5 }}>
            <span style={{ color: "var(--fg)" }}>{r.label}</span>
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <kbd style={{ background: "var(--panel-bg)", border: "1px solid var(--border)", borderRadius: 4, padding: "0 6px", fontSize: 12 }}>{r.combo}</kbd>
              <button
                onClick={() => edit(r.id)}
                style={{ background: "none", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 8px", cursor: "pointer", fontSize: 12, color: "var(--fg)" }}
              >
                {isZh ? "修改" : "Edit"}
              </button>
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
        <button onClick={() => { resetShortcuts(); setErr(""); }} style={{ padding: "6px 16px", cursor: "pointer" }}>
          {isZh ? "恢复默认" : "Reset all"}
        </button>
        <button onClick={() => setOpen(false)} style={{ padding: "6px 16px", cursor: "pointer" }}>
          {isZh ? "关闭" : "Close"}
        </button>
      </div>
    </div>
  );
}
