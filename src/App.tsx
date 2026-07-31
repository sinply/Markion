import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useVaultStore } from "./stores/vaultStore";
import { useSettingsStore } from "./stores/settingsStore";
import { Layout } from "./components/Layout";

export default function App() {
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
