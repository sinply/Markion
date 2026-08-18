import { useEffect, useState } from "react";
import { useUiStore } from "../stores/uiStore";
import { useVaultStore } from "../stores/vaultStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useI18n } from "../lib/i18n";
import { listTemplates, type TemplateFile } from "../lib/templates";
import { readFile } from "../lib/ipc";
import { getEditorView } from "../editor/registry";

/** Template picker: lists `.md` files in the configured template folder and
 *  inserts the chosen one at the editor cursor. */
export function TemplatesDialog() {
  const open = useUiStore((s) => s.templatesOpen);
  const setOpen = useUiStore((s) => s.setTemplatesOpen);
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const templateFolder = useSettingsStore((s) => s.templateFolder);
  const t = useI18n();
  const [templates, setTemplates] = useState<TemplateFile[]>([]);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!open || !vaultRoot) return;
    let cancelled = false;
    void (async () => {
      const list = await listTemplates(vaultRoot, templateFolder);
      if (cancelled) return;
      setTemplates(list);
      setErr(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, vaultRoot, templateFolder]);

  if (!open) return null;

  const insert = async (tpl: TemplateFile) => {
    if (!vaultRoot) return;
    try {
      const content = await readFile(vaultRoot, tpl.path);
      const view = getEditorView();
      if (view) {
        const { from } = view.state.selection.main;
        view.dispatch({ changes: { from, insert: content } });
        view.focus();
      }
    } catch {
      setErr(true);
      return;
    }
    setOpen(false);
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1001, background: "rgba(0,0,0,0.35)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        style={{
          width: 420, maxWidth: "90%", maxHeight: "70vh", display: "flex", flexDirection: "column",
          background: "var(--bg)", borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.3)", padding: 20,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 15 }}>{t.templatesTitle}</div>
        <div style={{ flex: 1, overflow: "auto", marginBottom: 12 }}>
          {templates.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--fg-muted)" }}>{t.templatesEmpty}</div>
          ) : (
            templates.map((tpl) => (
              <div
                key={tpl.path}
                data-testid="template-item"
                onClick={() => void insert(tpl)}
                style={{
                  padding: "8px 10px", cursor: "pointer", borderRadius: 5, fontSize: 13,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "var(--panel-bg-2)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                {tpl.name.replace(/\.md$/i, "")}
                <span style={{ color: "var(--fg-muted)", marginLeft: 8, fontSize: 11 }}>
                  {tpl.path}
                </span>
              </div>
            ))
          )}
          {err && (
            <div style={{ fontSize: 12, color: "#d73a49", marginTop: 8 }}>{t.templatesReadFailed}</div>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={() => setOpen(false)}
            style={{ padding: "6px 14px", cursor: "pointer", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)", borderRadius: 5 }}
          >
            {t.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
