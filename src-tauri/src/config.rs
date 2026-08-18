use serde::{Deserialize, Serialize};
use std::path::Path;

/// User settings, persisted to `.markion/config.json`.
/// Field names are snake_case on the Rust side; Tauri auto-converts the
/// frontend's camelCase keys (`assetsStrategy` -> `assets_strategy`, etc.).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Settings {
    /// "vault-assets" | "doc-assets" | "custom:<path>"
    pub assets_strategy: String,
    /// "relative" | "absolute"
    pub path_style: String,
    /// "system" | "light" | "dark"
    pub theme: String,
    /// Vault-relative folder holding note templates ("" = none).
    pub template_folder: String,
    pub show_hidden_files: bool,
    pub live_preview: bool,
    /// "zh" | "en"
    pub language: String,
    /// "system" | "serif" | "sans" | "mono" | "rounded"
    pub font: String,
    pub show_outline: bool,
    pub show_backlinks: bool,
    pub show_graph: bool,
    pub show_tags: bool,
    pub show_word_count: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            assets_strategy: "vault-assets".to_string(),
            path_style: "relative".to_string(),
            theme: "system".to_string(),
            template_folder: "Templates".to_string(),
            show_hidden_files: false,
            live_preview: true,
            language: "zh".to_string(),
            font: "system".to_string(),
            show_outline: true,
            show_backlinks: true,
            show_graph: true,
            show_tags: true,
            show_word_count: true,
        }
    }
}

const CONFIG_PATH: &str = ".markion/config.json";

/// Load config. Missing file or corrupt JSON both fall back to default -
/// never blocks the user.
pub fn load_config(vault_root: &Path) -> std::io::Result<Settings> {
    let path = vault_root.join(CONFIG_PATH);
    match std::fs::read_to_string(&path) {
        Ok(s) => match serde_json::from_str::<Settings>(&s) {
            Ok(parsed) => Ok(parsed),
            Err(e) => {
                eprintln!(
                    "[config] corrupt config at {:?}: {}; falling back to default",
                    path, e
                );
                Ok(Settings::default())
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(e) => Err(e),
    }
}

pub fn save_config(vault_root: &Path, settings: &Settings) -> std::io::Result<()> {
    let dir = vault_root.join(".markion");
    std::fs::create_dir_all(&dir)?;
    let path = vault_root.join(CONFIG_PATH);
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))?;
    crate::file_io::write_file_atomic(&path, &json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn load_missing_returns_default() {
        let dir = tempdir().unwrap();
        let s = load_config(dir.path()).unwrap();
        assert_eq!(s, Settings::default());
    }

    #[test]
    fn save_then_load_roundtrip() {
        let dir = tempdir().unwrap();
        let mut s = Settings::default();
        s.theme = "dark".to_string();
        s.assets_strategy = "doc-assets".to_string();
        s.live_preview = false;
        save_config(dir.path(), &s).unwrap();
        let loaded = load_config(dir.path()).unwrap();
        assert_eq!(loaded, s);
    }

    #[test]
    fn corrupt_config_returns_default() {
        let dir = tempdir().unwrap();
        let p = dir.path().join(".markion/config.json");
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, "not json {{{").unwrap();
        let s = load_config(dir.path()).unwrap();
        assert_eq!(s, Settings::default());
    }

    #[test]
    fn partial_config_keeps_defaults_for_missing_fields() {
        // #[serde(default)] means a config with only some fields still loads;
        // the provided field wins and the rest fall back to defaults.
        let dir = tempdir().unwrap();
        let p = dir.path().join(".markion/config.json");
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, r#"{"theme":"dark"}"#).unwrap();
        let s = load_config(dir.path()).unwrap();
        let mut expected = Settings::default();
        expected.theme = "dark".to_string();
        assert_eq!(s, expected);
    }
}
