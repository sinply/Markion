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

/// True when `rel` (vault-relative, forward slashes) lies inside the
/// app-state `.markion` directory itself. Matches only the exact directory
/// component, so sibling names like `.markion-notes.md` stay watched.
fn is_markion_internal(rel: &str) -> bool {
    rel == ".markion" || rel.starts_with(".markion/")
}

/// Flush rule for the debounced sender: emit once the event stream has been
/// quiet for a whole debounce period, OR when the oldest buffered event has
/// already waited 4×debounce so a sustained storm cannot starve delivery.
fn should_flush(quiet_for: Duration, oldest_age: Duration, debounce: Duration) -> bool {
    quiet_for >= debounce || oldest_age >= debounce * 4
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
                // Normalize separators so the filter matches on every OS.
                let rel = p
                    .strip_prefix(&root)
                    .unwrap_or(p)
                    .to_string_lossy()
                    .replace('\\', "/");
                if is_markion_internal(&rel) {
                    // Ignore changes to the app-state dir itself; `continue`
                    // keeps remaining paths of this multi-path event alive.
                    continue;
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
        let mut oldest = last;
        loop {
            match rx_raw.recv_timeout(debounce) {
                Ok(ev) => {
                    if buffer.is_empty() {
                        oldest = Instant::now();
                    }
                    buffer.push(ev);
                    last = Instant::now();
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if !buffer.is_empty()
                        && should_flush(last.elapsed(), oldest.elapsed(), debounce)
                    {
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

    #[test]
    fn markion_filter_matches_only_the_exact_dir_component() {
        assert!(is_markion_internal(".markion"));
        assert!(is_markion_internal(".markion/index.json"));
        assert!(is_markion_internal(".markion/trash/gone.md"));
        // Sibling names sharing the prefix must NOT be swallowed.
        assert!(!is_markion_internal(".markion-notes.md"));
        assert!(!is_markion_internal(".markionize/x.md"));
        assert!(!is_markion_internal("notes/.markion-notes.md"));
    }

    #[test]
    fn flush_rule_debounces_quiet_streams_and_bounds_storm_latency() {
        let d = Duration::from_millis(100);
        // Storm in progress: neither quiet nor max-latency reached -> buffer.
        assert!(!should_flush(
            Duration::from_millis(0),
            Duration::from_millis(0),
            d
        ));
        assert!(!should_flush(
            Duration::from_millis(50),
            Duration::from_millis(399),
            d
        ));
        // Quiet for a full debounce period -> flush.
        assert!(should_flush(d, Duration::ZERO, d));
        // Sustained storm: oldest buffered event waited >= 4x debounce -> flush.
        assert!(should_flush(Duration::ZERO, d * 4, d));
        assert!(should_flush(Duration::from_millis(1), d * 10, d));
    }
}
