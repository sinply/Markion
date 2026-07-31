use std::fs;
use std::path::Path;

pub fn read_file(path: &Path) -> std::io::Result<String> {
    fs::read_to_string(path)
}

pub fn write_file_atomic(path: &Path, content: &str) -> std::io::Result<()> {
    let dir = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent")
    })?;
    let file_name = path
        .file_name()
        .ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no file name")
        })?
        .to_string_lossy();
    let tmp = dir.join(format!(".{}.tmp", file_name));
    fs::write(&tmp, content)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[test]
    fn write_then_read_returns_same_content() {
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path();
        write_file_atomic(path, "hello world\nsecond line").unwrap();
        assert_eq!(read_file(path).unwrap(), "hello world\nsecond line");
    }

    #[test]
    fn write_does_not_leave_temp_file() {
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path();
        write_file_atomic(path, "data").unwrap();
        let parent = path.parent().unwrap();
        let temps: Vec<_> = fs::read_dir(parent)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                let n = e.file_name().to_string_lossy().to_string();
                n.starts_with('.') && n.ends_with(".tmp")
            })
            .collect();
        assert!(temps.is_empty(), "leftover temp: {:?}", temps);
    }

    #[test]
    fn read_missing_file_errors() {
        let path = Path::new("/nonexistent/does/not/exist.md");
        assert!(read_file(path).is_err());
    }
}
