import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useVaultStore, getDefaultVault } from "./stores/vaultStore";
import { useSettingsStore } from "./stores/settingsStore";
import { startVaultWatch } from "./lib/ipc";
import { Layout } from "./components/Layout";
import { MenuBar } from "./components/MenuBar";
import { Splash } from "./components/Splash";
import { AboutDialog } from "./components/AboutDialog";
import { HelpDialog } from "./components/HelpDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { ConflictDialog } from "./components/ConflictDialog";
import { DeletedDialog } from "./components/DeletedDialog";
import { SearchDialog } from "./components/SearchDialog";
import { TemplatesDialog } from "./components/TemplatesDialog";
import { PropertiesDialog } from "./components/PropertiesDialog";
import { TrashDialog } from "./components/TrashDialog";
import { VaultsDialog } from "./components/VaultsDialog";
import { BaseDialog } from "./components/BaseDialog";
import { Slideshow } from "./components/Slideshow";
import { useTheme } from "./hooks/useTheme";
import { useFont } from "./hooks/useFont";
import { useCommands } from "./hooks/useCommands";

async function openVaultAndWatch(
  folder: string,
  openVault: (r: string) => Promise<void>,
  loadSettings: (r: string) => Promise<void>,
) {
  await openVault(folder);
  await loadSettings(folder);
  try {
    await startVaultWatch(folder);
  } catch {
    // watcher failure is non-fatal
  }
}

export default function App() {
  useTheme();
  useFont();
  useCommands();
  const openVault = useVaultStore((s) => s.openVault);
  const setAsDefault = useVaultStore((s) => s.setAsDefault);
  const loadSettings = useSettingsStore((s) => s.load);
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const [booted, setBooted] = useState(false);
  const [loading, setLoading] = useState(false);

  // On startup, auto-open the default vault if one was saved.
  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const saved = getDefaultVault();
      if (saved) {
        setLoading(true);
        try {
          await openVaultAndWatch(saved, openVault, loadSettings);
        } catch {
          // saved vault no longer accessible — fall through to the picker
        }
        if (!cancelled) setLoading(false);
      }
      if (!cancelled) setBooted(true);
    };
    void boot();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickVault = async () => {
    const folder = await open({ directory: true, multiple: false });
    if (typeof folder !== "string") return;
    setLoading(true);
    await openVaultAndWatch(folder, openVault, loadSettings);
    setLoading(false);
    // Ask the user once (when no default is set) whether to make it the default.
    if (!getDefaultVault()) {
      const makeDefault = window.confirm(
        `Set "${folder}" as the default vault to auto-open on startup?`,
      );
      if (makeDefault) setAsDefault();
    }
  };

  if (loading || !booted) {
    return <Splash />;
  }

  if (!vaultRoot) {
    return (
      <div className="markion-app-fade" style={{ padding: 32, textAlign: "center", fontFamily: "sans-serif" }}>
        <h1>Markion</h1>
        <p style={{ color: "#666" }}>A fast, local-first Markdown editor</p>
        <button
          onClick={pickVault}
          style={{ fontSize: 16, padding: "8px 24px", marginTop: 16 }}
        >
          Open vault folder
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="markion-app-fade" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <MenuBar />
        <div style={{ flex: 1, minHeight: 0 }}>
          <Layout />
        </div>
      </div>
      <SettingsDialog />
      <AboutDialog />
      <HelpDialog />
      <ShortcutsDialog />
      <ConflictDialog />
      <DeletedDialog />
      <SearchDialog />
      <TemplatesDialog />
      <PropertiesDialog />
      <TrashDialog />
      <VaultsDialog />
      <BaseDialog />
      <Slideshow />
    </>
  );
}
