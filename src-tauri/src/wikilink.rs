//! Shared `[[wikilink]]` scanner.
//!
//! Used by the fallback scans in [`crate::backlinks`] and — through
//! `backlinks::link_targets` — by the primary `LinkIndex`. The scanner is
//! markdown-aware so that literal code does not create phantom links:
//!
//! - fenced code blocks (` ``` ` / ` ~~~ `, marker run >= 3 at line start,
//!   matching closer needs the same marker char and >= the opener's length)
//!   are skipped entirely; the fence line itself emits nothing link-wise;
//! - inline-code spans are stripped per line before token scanning (backtick
//!   runs open/close spans pairwise on a line; a run only closes a span of
//!   the same length);
//! - alias (`|`) is stripped first, then heading/block anchors (`#`),
//!   then the path prefix is reduced to the filename stem.
//!
//! Stems are lowercased (matching `target_key` / LinkIndex conventions),
//! order is preserved and duplicates are NOT removed — dedup stays in the
//! callers where they already did it.

/// Extract every `[[...]]` target stem from `text`.
pub(crate) fn extract_wikilink_targets(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut in_fence = false;
    let mut fence_marker: Option<char> = None; // ` or ~
    let mut fence_len = 0usize;
    for line in text.lines() {
        let trimmed = line.trim_start();
        // A fence toggles only when the marker run is at the START of the
        // line (whitespace allowed) and >= 3 chars — the actual Markdown
        // syntax. Inline triple backticks are never at the line start, so
        // they cannot toggle state here either.
        if let Some((ch, run_len)) = fence_at_start(trimmed) {
            if !in_fence {
                // Opening fence (any marker).
                fence_marker = Some(ch);
                fence_len = run_len;
                in_fence = true;
            } else if Some(ch) == fence_marker && run_len >= fence_len {
                // Closing fence: same marker, run at least the opener's length.
                fence_marker = None;
                fence_len = 0;
                in_fence = false;
            }
            // The fence line itself (markers + optional info string) is
            // skipped — links on it are literal code, not references.
            continue;
        }
        if in_fence {
            continue; // content lines inside a fence emit nothing
        }
        scan_line(&strip_inline_code(trimmed), &mut out);
    }
    out
}

/// Scan one fence-free, inline-code-stripped line for `[[...]]` tokens.
fn scan_line(line: &str, out: &mut Vec<String>) {
    let mut rest = line;
    while let Some(start) = rest.find("[[") {
        rest = &rest[start + 2..];
        let Some(end) = rest.find("]]") else {
            break;
        };
        let token = &rest[..end];
        rest = &rest[end + 2..];
        // Alias first ([[name|alias]]) — anchors cannot contain '|'.
        let target_part = token.split('|').next().unwrap_or(token);
        // Then heading/block anchors ([[note#section]], [[note#^abc]]).
        let target_part = target_part.split('#').next().unwrap_or(target_part);
        // Stem after the last '/'.
        let stem = target_part.rsplit('/').next().unwrap_or(target_part);
        let stem = stem.trim().to_lowercase();
        if !stem.is_empty() {
            out.push(stem);
        }
    }
}

/// Remove inline-code spans (backtick runs opened/closed pairwise on the
/// line) so `` `[[x]]` `` stops counting as a link. A run only CLOSES a span
/// of the same length (CommonMark rule); an unterminated span swallows the
/// rest of the line.
fn strip_inline_code(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut in_code = false;
    let mut opener_len = 0usize;
    let mut i = 0usize;
    while i < line.len() {
        let c = line[i..].chars().next().unwrap();
        if c == '`' {
            let run = line[i..].chars().take_while(|&ch| ch == '`').count();
            if in_code && run == opener_len {
                in_code = false;
            } else if !in_code {
                in_code = true;
                opener_len = run;
            }
            i += run; // backticks are ASCII: one byte each
            continue;
        }
        if !in_code {
            out.push(c);
        }
        i += c.len_utf8();
    }
    out
}

/// If the (already leading-trimmed) line starts with a ``` or ~~~ run of
/// >= 3 chars, return the marker char and its length. An info string after
/// the run (` ```js `) is allowed; text before the run disqualifies the line
/// (that is inline code, not a fence).
fn fence_at_start(line: &str) -> Option<(char, usize)> {
    let ch = line.chars().next()?;
    if ch != '`' && ch != '~' {
        return None;
    }
    let run_len = line.chars().take_while(|&c| c == ch).count();
    if run_len >= 3 {
        Some((ch, run_len))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_stems_preserving_order_without_dedup() {
        assert_eq!(
            extract_wikilink_targets("See [[design]] and [[notes/api]] then [[design]]"),
            vec!["design", "api", "design"]
        );
        assert_eq!(extract_wikilink_targets("no links"), Vec::<String>::new());
        assert_eq!(extract_wikilink_targets("[[unclosed"), Vec::<String>::new());
        assert_eq!(extract_wikilink_targets("[[ ]]").len(), 0); // whitespace-only dropped
    }

    #[test]
    fn strips_alias_then_anchor_before_stem() {
        assert_eq!(extract_wikilink_targets("[[a|alias]]"), vec!["a"]);
        assert_eq!(extract_wikilink_targets("[[design#Intro]]"), vec!["design"]);
        assert_eq!(extract_wikilink_targets("[[note#^abc123]]"), vec!["note"]);
        assert_eq!(
            extract_wikilink_targets("[[notes/design#Section Two|Alias]]"),
            vec!["design"]
        );
    }

    #[test]
    fn lowercases_stems() {
        assert_eq!(
            extract_wikilink_targets("[[Design]] [[ÜBER]]"),
            vec!["design", "über"]
        );
    }

    #[test]
    fn fenced_blocks_are_skipped() {
        assert!(extract_wikilink_targets("```\n[[x]]\n```").is_empty());
        assert!(extract_wikilink_targets("~~~\n[[x]]\n~~~").is_empty());
        assert!(extract_wikilink_targets("```js\n[[x]]\n```\n").is_empty());
        // Mixed markers: ~~~ must not close a ``` fence.
        assert!(extract_wikilink_targets("```\n[[x]]\n~~~\n[[x]]\n```").is_empty());
        // Links outside the fence still count.
        assert_eq!(
            extract_wikilink_targets("[[a]]\n```\n[[x]]\n```\n[[b]]"),
            vec!["a", "b"]
        );
        // A shorter/different-marker run inside an open fence does not close it.
        assert!(extract_wikilink_targets("~~~~\n[[x]]\n```\n[[y]]\n~~~~").is_empty());
    }

    #[test]
    fn inline_triple_backticks_do_not_open_a_fence() {
        // `` `x ```y``` ` `` is inline code on a normal line: it must not
        // open a fence that swallows the link below it.
        assert_eq!(
            extract_wikilink_targets("`code ```x``` ` text\n\n[[real]]"),
            vec!["real"]
        );
    }

    #[test]
    fn inline_code_spans_are_skipped() {
        assert!(extract_wikilink_targets("see `[[x]]` here").is_empty());
        // Pairwise spans on one line; real links around them survive.
        assert_eq!(
            extract_wikilink_targets("[[pre]] `[[x]]` mid ``p`` [[post]]"),
            vec!["pre", "post"]
        );
        // A longer run inside a short span does not close it: everything up
        // to the matching closer stays code.
        assert!(extract_wikilink_targets("`a ```b [[x]] c`").is_empty());
        // Double-backtick span containing single backticks.
        assert!(extract_wikilink_targets("``a `b [[x]]`` tail").is_empty());
    }
}
