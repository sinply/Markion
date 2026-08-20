import { useUiStore } from "../stores/uiStore";
import { useVaultStore } from "../stores/vaultStore";
import { useI18n } from "../lib/i18n";

/** Multi-vault manager: list recently opened vaults, switch to one, remove it
 *  from the list, or pin it as the default (auto-opened on startup). */
export function VaultsDialog() {
  const open = useUiStore((s) => s.vaultsOpen);
  const setOpen = useUiStore((s) => s.setVaultsOpen);
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const recentVaults = useVaultStore((s) => s.recentVaults);
  const switchVault = useVaultStore((s) => s.switchVault);
  const forgetVault = useVaultStore((s) => s.forgetVault);
  const setDefaultTo = useVaultStore((s) => s.setDefaultTo);
  const t = useI18n();

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1001,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        style={{
          width: 520,
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--panel-bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "12px 16px", fontWeight: 600, fontSize: 14, borderBottom: "1px solid var(--border)" }}>
          {t.vaultsTitle}
        </div>
        <div style={{ padding: "8px 16px", overflow: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {recentVaults.length === 0 && (
            <div style={{ color: "var(--fg-muted)", fontSize: 13, padding: "8px 0" }}>{t.vaultsEmpty}</div>
          )}
          {recentVaults.map((v) => (
            <div
              key={v}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 0",
                borderBottom: "1px solid var(--border)",
                fontSize: 13,
              }}
            >
              <span style={{ width: 18, opacity: 0.8 }}>{v === vaultRoot ? "✓" : ""}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }} title={v} onClick={() => { void switchVault(v); setOpen(false); }}>
                {v}
              </span>
              <button
                title={t.vaultsPin}
                style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14 }}
                onClick={() => setDefaultTo(v)}
              >
                ★
              </button>
              <button
                title={t.vaultsOpen}
                style={{ border: "1px solid var(--border)", borderRadius: 4, background: "none", cursor: "pointer", fontSize: 12, padding: "2px 8px", color: "var(--fg)" }}
                onClick={() => { void switchVault(v); setOpen(false); }}
              >
                {t.vaultsOpen}
              </button>
              <button
                title={t.vaultsForget}
                style={{ border: "none", background: "none", cursor: "pointer", color: "var(--fg-muted)", fontSize: 14 }}
                onClick={() => forgetVault(v)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
          <button
            style={{
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--fg)",
              padding: "6px 14px",
              cursor: "pointer",
              fontSize: 13,
            }}
            onClick={() => setOpen(false)}
          >
            {t.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}