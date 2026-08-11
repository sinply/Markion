import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import { useI18n, THEME_LABELS } from "../lib/i18n";
import type { Theme } from "../lib/types";

export function SettingsDialog() {
  const settings = useSettingsStore();
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const t = useI18n();

  if (!open) return null;

  const themes = Object.keys(THEME_LABELS[settings.language]) as Theme[];

  return (
    <div
      style={{
        position: "fixed", top: "10%", left: "30%", width: "40%",
        background: "var(--bg)", boxShadow: "0 4px 24px rgba(0,0,0,0.2)", borderRadius: 8,
        zIndex: 2000, padding: 16, fontSize: 14,
      }}
    >
      <h2 style={{ margin: "0 0 12px 0" }}>{t.settingsTitle}</h2>

      <div style={{ margin: "8px 0" }}>
        <label>{t.language}{" "}</label>
        <select
          value={settings.language}
          onChange={(e) => settings.setLanguage(e.target.value as any)}
        >
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </div>

      <div style={{ margin: "8px 0" }}>
        <label>{t.assetsDir}{" "}</label>
        <select
          value={settings.assetsStrategy}
          onChange={(e) => settings.setAssetsStrategy(e.target.value as any)}
        >
          <option value="vault-assets">{t.vaultAssets}</option>
          <option value="doc-assets">{t.docAssets}</option>
          <option value="custom">{t.customPath}</option>
        </select>
      </div>

      <div style={{ margin: "8px 0" }}>
        <label>{t.pathStyle}{" "}</label>
        <select
          value={settings.pathStyle}
          onChange={(e) => settings.setPathStyle(e.target.value as any)}
        >
          <option value="relative">{t.relToDoc}</option>
          <option value="absolute">{t.absPath}</option>
        </select>
      </div>

      <div style={{ margin: "8px 0" }}>
        <label>{t.theme}:{" "}</label>
        <select
          value={settings.theme}
          onChange={(e) => settings.setTheme(e.target.value as any)}
        >
          {themes.map((val) => (
            <option key={val} value={val}>
              {THEME_LABELS[settings.language][val]}
            </option>
          ))}
        </select>
      </div>

      <div style={{ margin: "8px 0" }}>
        <label>{t.font}:{" "}</label>
        <select
          value={settings.font}
          onChange={(e) => settings.setFont(e.target.value as any)}
        >
          <option value="system">{t.fontSystem}</option>
          <option value="serif">{t.fontSerif}</option>
          <option value="sans">{t.fontSans}</option>
          <option value="mono">{t.fontMono}</option>
          <option value="rounded">{t.fontRounded}</option>
        </select>
      </div>

      <div style={{ margin: "8px 0" }}>
        <label>
          <input
            type="checkbox"
            checked={settings.livePreview}
            onChange={(e) => settings.setLivePreview(e.target.checked)}
          />
          {" "}{t.livePreviewLabel}
        </label>
      </div>

      <div style={{ margin: "8px 0" }}>
        <label>
          <input
            type="checkbox"
            checked={settings.showHiddenFiles}
            onChange={(e) => settings.setShowHiddenFiles(e.target.checked)}
          />
          {" "}{t.showHidden}
        </label>
      </div>

      <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Panels</div>
        <div style={{ margin: "4px 0" }}>
          <label>
            <input
              type="checkbox"
              checked={settings.showOutline}
              onChange={(e) => settings.setShowOutline(e.target.checked)}
            />
            {" "}{t.showOutline}
          </label>
        </div>
        <div style={{ margin: "4px 0" }}>
          <label>
            <input
              type="checkbox"
              checked={settings.showBacklinks}
              onChange={(e) => settings.setShowBacklinks(e.target.checked)}
            />
            {" "}{t.showBacklinks}
          </label>
        </div>
        <div style={{ margin: "4px 0" }}>
          <label>
            <input
              type="checkbox"
              checked={settings.showGraph}
              onChange={(e) => settings.setShowGraph(e.target.checked)}
            />
            {" "}{t.showGraph}
          </label>
        </div>
        <div style={{ margin: "4px 0" }}>
          <label>
            <input
              type="checkbox"
              checked={settings.showWordCount}
              onChange={(e) => settings.setShowWordCount(e.target.checked)}
            />
            {" "}{t.showWordCount}
          </label>
        </div>
      </div>

      <button onClick={() => setOpen(false)} style={{ marginTop: 8 }}>
        {t.close}
      </button>
    </div>
  );
}
