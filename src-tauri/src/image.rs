use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub enum AssetsStrategy {
    VaultAssets,
    DocAssets,
    Custom(PathBuf),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PathStyle {
    Relative,
    Absolute,
}

/// First 12 hex chars of sha256(content) (48 bits — collision-safe dedup).
pub fn hash_content(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let hash = hasher.finalize();
    let hex = format!("{:x}", hash);
    hex[..12].to_string()
}

pub fn save_image(
    bytes: &[u8],
    ext: &str,
    vault_root: &Path,
    doc_rel: &Path,
    strategy: &AssetsStrategy,
    path_style: PathStyle,
    date: &str,
) -> std::io::Result<String> {
    // Sanitize the document-relative path up front: normalize Windows
    // separators to '/' and refuse any '..' segment, so neither the derived
    // assets subfolder nor the returned link can escape the vault.
    let doc_norm = doc_rel.to_string_lossy().replace('\\', "/");
    if doc_norm.split('/').any(|seg| seg == "..") {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("doc path must not contain '..' segments: {doc_norm}"),
        ));
    }
    let doc_rel = Path::new(&doc_norm);

    let hash = hash_content(bytes);
    let filename = format!("{}-{}.{}", date, hash, ext);

    let assets_dir: PathBuf = match strategy {
        AssetsStrategy::VaultAssets => vault_root.join("assets"),
        AssetsStrategy::DocAssets => {
            let doc_dir = doc_rel.parent().unwrap_or(Path::new(""));
            vault_root.join(doc_dir).join("assets")
        }
        AssetsStrategy::Custom(p) => p.clone(),
    };
    fs::create_dir_all(&assets_dir)?;

    let target = assets_dir.join(&filename);
    if !target.exists() {
        fs::write(&target, bytes)?;
    }

    let path_str = match path_style {
        PathStyle::Absolute => target.to_string_lossy().to_string(),
        PathStyle::Relative => {
            let doc_dir = vault_root.join(doc_rel.parent().unwrap_or(Path::new("")));
            match pathdiff::diff_paths(&target, &doc_dir) {
                Some(rel) => rel.to_string_lossy().to_string().replace('\\', "/"),
                None => target.to_string_lossy().to_string(),
            }
        }
    };
    Ok(path_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn hash_is_deterministic() {
        let h1 = hash_content(b"hello");
        let h2 = hash_content(b"hello");
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 12);
    }

    #[test]
    fn hash_differs_for_different_content() {
        assert_ne!(hash_content(b"hello"), hash_content(b"world"));
    }

    #[test]
    fn save_vault_assets_relative_path() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("notes")).unwrap();
        fs::write(root.join("notes/a.md"), "").unwrap();
        let path = save_image(
            b"pngbytes",
            "png",
            root,
            Path::new("notes/a.md"),
            &AssetsStrategy::VaultAssets,
            PathStyle::Relative,
            "20260731",
        )
        .unwrap();
        assert_eq!(path, "../assets/20260731-b234c92b02e0.png");
        assert!(root.join("assets/20260731-b234c92b02e0.png").exists());
    }

    #[test]
    fn save_dedup_does_not_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let doc = Path::new("a.md");
        let first = save_image(
            b"pngbytes",
            "png",
            root,
            doc,
            &AssetsStrategy::VaultAssets,
            PathStyle::Relative,
            "20260731",
        )
        .unwrap();
        let abs = root.join("assets/20260731-b234c92b02e0.png");
        fs::write(&abs, b"TAMPERED").unwrap();
        let second = save_image(
            b"pngbytes",
            "png",
            root,
            doc,
            &AssetsStrategy::VaultAssets,
            PathStyle::Relative,
            "20260731",
        )
        .unwrap();
        assert_eq!(first, second);
        assert_eq!(fs::read(&abs).unwrap(), b"TAMPERED");
    }

    #[test]
    fn save_doc_assets_rejects_parent_segments() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let err = save_image(
            b"pngbytes",
            "png",
            root,
            Path::new("../evil.md"),
            &AssetsStrategy::DocAssets,
            PathStyle::Absolute,
            "",
        )
        .unwrap_err();
        assert!(err.to_string().contains(".."), "unexpected error: {err}");
    }

    #[test]
    fn save_doc_assets_normalizes_backslashes_in_doc_rel() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let out = save_image(
            b"pngbytes",
            "png",
            root,
            Path::new("notes\\a.md"),
            &AssetsStrategy::DocAssets,
            PathStyle::Relative,
            "",
        )
        .unwrap();
        // The assets folder is derived from the normalized doc directory...
        assert!(root.join("notes").join("assets").is_dir());
        // ...and the returned link uses forward slashes only.
        assert!(!out.contains('\\'), "link should be normalized: {out}");
    }
}
