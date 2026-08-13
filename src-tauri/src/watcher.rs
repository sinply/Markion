use notify::EventKind;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::Path;
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq)]
pub struct WatchEvent {
    pub path: String,
    pub kind: EventKind,
}

/// Deduplicate events by path, preserving first-seen order.
pub fn coalesce_paths(events: &[WatchEvent]) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut result: Vec<String> = Vec::new();
    for e in events {
        if seen.insert(e.path.clone()) {
            result.push(e.path.clone());
        }
    }
    result
}

/// Start a recursive watcher on `vault_root`. Returns the watcher handle
/// (keep it alive) and a receiver of coalesced, debounced path lists.
pub fn start_watcher(
    vault_root: &Path,
    debounce: Duration,
) -> std::io::Result<(RecommendedWatcher, Receiver<Vec<String>>)> {
    let (tx_raw, rx_raw) = channel::<WatchEvent>();
    let root = vault_root.to_path_buf();

    let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, _>| {
        if let Ok(ev) = res {
            for p in &ev.paths {
                let rel = p
                    .strip_prefix(&root)
                    .unwrap_or(p)
                    .to_string_lossy()
                    .to_string();
                if rel.starts_with(".markion") {
                    // Ignore changes to the index file itself
                    return;
                }
                let _ = tx_raw.send(WatchEvent {
                    path: rel,
                    kind: ev.kind,
                });
            }
        }
    })
    .map_err(|e| std::io::Error::other(e.to_string()))?;

    watcher
        .watch(vault_root, RecursiveMode::Recursive)
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    let (tx_debounced, rx_debounced) = channel::<Vec<String>>();
    std::thread::spawn(move || {
        let mut buffer: Vec<WatchEvent> = Vec::new();
        let mut last = Instant::now();
        loop {
            match rx_raw.recv_timeout(debounce) {
                Ok(ev) => {
                    buffer.push(ev);
                    last = Instant::now();
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if !buffer.is_empty() && last.elapsed() >= debounce {
                        let coalesced = coalesce_paths(&buffer);
                        if tx_debounced.send(coalesced).is_err() {
                            break;
                        }
                        buffer.clear();
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    if !buffer.is_empty() {
                        let _ = tx_debounced.send(coalesce_paths(&buffer));
                    }
                    break;
                }
            }
        }
    });

    Ok((watcher, rx_debounced))
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, ModifyKind};

    #[test]
    fn coalesce_dedups_same_path() {
        let events = vec![
            WatchEvent {
                path: "a.md".into(),
                kind: EventKind::Modify(ModifyKind::Any),
            },
            WatchEvent {
                path: "a.md".into(),
                kind: EventKind::Modify(ModifyKind::Any),
            },
            WatchEvent {
                path: "b.md".into(),
                kind: EventKind::Create(CreateKind::Any),
            },
        ];
        assert_eq!(coalesce_paths(&events), vec!["a.md", "b.md"]);
    }

    #[test]
    fn coalesce_empty_returns_empty() {
        assert!(coalesce_paths(&[]).is_empty());
    }
}
