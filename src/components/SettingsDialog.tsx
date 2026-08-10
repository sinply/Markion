import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";

export function SettingsDialog() {
  const settings = useSettingsStore();
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", top: "10%", left: "30%", width: "40%",
        background: "var(--bg)", boxShadow: "0 4px 24px rgba(0,0,0,0.2)", borderRadius: 8,
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
          <option value="system">System (follow OS)</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="sepia">Sepia</option>
          <option value="eye">Eye-care</option>
          <option value="nord">Nord</option>
          <option value="dracula">Dracula</option>
          <option value="solarized">Solarized</option>
        </select>
      </div>

      <div style={{ margin: "8px 0" }}>
        <label>
          <input
            type="checkbox"
            checked={settings.livePreview}
            onChange={(e) => settings.setLivePreview(e.target.checked)}
          />
          {" "}Live preview (real-time markdown rendering)
        </label>
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
