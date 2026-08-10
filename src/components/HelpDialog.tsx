import { useUiStore } from "../stores/uiStore";
import { useI18n } from "../lib/i18n";

export function HelpDialog() {
  const open = useUiStore((s) => s.helpOpen);
  const setOpen = useUiStore((s) => s.setHelpOpen);
  const t = useI18n();

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", top: "6%", left: "20%", width: "60%", maxHeight: "84%",
        background: "var(--bg)", boxShadow: "0 6px 30px rgba(0,0,0,0.3)", borderRadius: 10,
        zIndex: 3000, padding: 20, fontSize: 14, display: "flex", flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0, flex: 1 }}>{t.dialogTitle}</h2>
        <button
          onClick={() => setOpen(false)}
          style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 18, color: "var(--fg-muted)" }}
        >
          ×
        </button>
      </div>
      <div style={{ overflow: "auto", flex: 1 }}>
        {t.helpSections.map((s) => (
          <div key={s.title} style={{ marginBottom: 14 }}>
            <h3 style={{ margin: "0 0 4px 0", fontSize: 15 }}>{s.title}</h3>
            {s.body.map((p, i) => (
              <p key={i} style={{ margin: "0 0 6px 0", lineHeight: 1.6, color: "var(--fg)" }}>
                {p}
              </p>
            ))}
          </div>
        ))}
      </div>
      <button onClick={() => setOpen(false)} style={{ padding: "6px 16px", marginTop: 12, cursor: "pointer" }}>
        {t.close}
      </button>
    </div>
  );
}
