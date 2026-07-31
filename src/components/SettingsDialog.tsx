import { useState } from "react";
import { useSettingsStore } from "../stores/settingsStore";

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const settings = useSettingsStore();

  const btnStyle = {
    position: "fixed" as const,
    top: 6,
    right: 8,
    zIndex: 100,
    background: "none",
    border: "1px solid #ddd",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 16,
    padding: "2px 6px",
  };

  if (!open) return <button style={btnStyle} onClick={() => setOpen(true)}>{"⚙"}</button>;

  return (
    <div
      style={{
        position: "fixed", top: "10%", left: "30%", width: "40%",
        background: "#fff", boxShadow: "0 4px 24px rgba(0,0,0,0.2)", borderRadius: 8,
        zIndex: 2000, padding: 16, fontSize: 14,
      }}
    >
      <h2 style={{ margin: "0 0 12px 0" }}>Settings</h2>

      <div style={{ margin: "8px 0" }}>
        <label>Assets directory:{" "}</label>
        <select
          value={settings.assetsStrategy}
          onChange={(e) => settings.setAssetsStrategy(e.target.value as any)}
        >
          <option value="vault-assets">Vault-level (assets/)</option>
          <option value="doc-assets">Document-side (assets/)</option>
          <option value="custom">Custom path</option>
        </select>
      </div>

      <div style={{ margin: "8px 0" }}>
        <label>Path style:{" "}</label>
        <select
          value={settings.pathStyle}
          onChange={(e) => settings.setPathStyle(e.target.value as any)}
        >
          <option value="relative">Relative to document</option>
          <option value="absolute">Absolute path</option>
        </select>
      </div>

      <div style={{ margin: "8px 0" }}>
        <label>Theme:{" "}</label>
        <select
          value={settings.theme}
          onChange={(e) => settings.setTheme(e.target.value as any)}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>

      <div style={{ margin: "8px 0" }}>
        <label>
          <input
            type="checkbox"
            checked={settings.showHiddenFiles}
            onChange={(e) => settings.setShowHiddenFiles(e.target.checked)}
          />
          {" "}Show hidden files
        </label>
      </div>

      <button onClick={() => setOpen(false)} style={{ marginTop: 8 }}>
        Close
      </button>
    </div>
  );
}
