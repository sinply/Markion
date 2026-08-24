import { useUiStore } from "../stores/uiStore";
import { useI18n } from "../lib/i18n";

const VERSION = "0.12.6";

export function AboutDialog() {
  const open = useUiStore((s) => s.aboutOpen);
  const setOpen = useUiStore((s) => s.setAboutOpen);
  const t = useI18n();

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", top: "25%", left: "32%", width: "36%",
        background: "var(--bg)", boxShadow: "0 4px 24px rgba(0,0,0,0.25)", borderRadius: 8,
        zIndex: 3000, padding: 20, fontSize: 14,
      }}
    >
      <h2 style={{ margin: "0 0 8px 0" }}>Markion</h2>
      <div style={{ color: "var(--fg-muted)", marginBottom: 8 }}>
        {t.aboutVersion} {VERSION}
      </div>
      <p style={{ margin: "0 0 12px 0", lineHeight: 1.6 }}>{t.aboutDesc}</p>
      <p style={{ margin: "0 0 16px 0", color: "var(--fg-muted)", fontSize: 13 }}>
        {t.aboutCredits}
      </p>
      <button
        onClick={() => setOpen(false)}
        style={{ padding: "6px 16px", cursor: "pointer" }}
      >
        {t.ok}
      </button>
    </div>
  );
}
