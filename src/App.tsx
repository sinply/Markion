import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useVaultStore } from "./stores/vaultStore";
import { useSettingsStore } from "./stores/settingsStore";
import { startVaultWatch } from "./lib/ipc";
import { Layout } from "./components/Layout";
import { useTheme } from "./hooks/useTheme";

export default function App() {
  useTheme();
  const loadTree = useVaultStore((s) => s.loadTree);
  const loadSettings = useSettingsStore((s) => s.load);
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const [loading, setLoading] = useState(false);

  const pickVault = async () => {
    const folder = await open({ directory: true, multiple: false });
    if (typeof folder !== "string") return;
    setLoading(true);
    await loadTree(folder);
    await loadSettings(folder);
    // Begin watching for external file changes (tree rebuilds + open-file reload
    // are handled by listeners in Layout/EditorPane).
    try {
      await startVaultWatch(folder);
    } catch {
      // watcher failure is non-fatal - the app still works, just no live refresh
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: "center", fontFamily: "sans-serif" }}>
        Loading vault…
      </div>
    );
  }

  if (!vaultRoot) {
    return (
      <div style={{ padding: 32, textAlign: "center", fontFamily: "sans-serif" }}>
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

  return <Layout />;
}
