import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { markdownContextFacet } from "./media";
import { formatTableSource } from "./widgets";

/** Wrap the selection (or word at cursor) with prefix/suffix. */
function wrap(view: EditorView, prefix: string, suffix: string, placeholder = "text") {
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to);
  const inner = sel || placeholder;
  const inserted = prefix + inner + suffix;
  view.dispatch({
    changes: { from, to, insert: inserted },
    selection: EditorSelection.cursor(from + prefix.length + inner.length),
  });
}

/** Toggle a block prefix on each selected line (e.g. `# `, `> `, `- `).
 *  Each line is judged independently: a line already carrying the prefix has
 *  it removed, any other line gets it prepended. */
function toggleLinePrefix(view: EditorView, prefix: string) {
  const { from, to } = view.state.selection.main;
  const changes: { from: number; to: number; insert: string }[] = [];
  let cur = from;
  while (true) {
    const l = view.state.doc.lineAt(cur);
    const ltext = view.state.sliceDoc(l.from, l.to);
    if (ltext.startsWith(prefix)) {
      changes.push({ from: l.from, to: l.from + prefix.length, insert: "" });
    } else {
      changes.push({ from: l.from, to: l.from, insert: prefix });
    }
    if (l.to >= to) break;
    cur = l.to + 1;
  }
  view.dispatch({ changes });
}

/** Set a heading level (1..6) on each selected line, toggling off when the
 *  line already has exactly that level; other levels are replaced. */
function setHeading(view: EditorView, level: number) {
  const { from, to } = view.state.selection.main;
  const prefix = "#".repeat(level) + " ";
  const changes: { from: number; to: number; insert: string }[] = [];
  let cur = from;
  while (true) {
    const l = view.state.doc.lineAt(cur);
    const ltext = view.state.sliceDoc(l.from, l.to);
    const m = ltext.match(/^(#{1,6})\s+/);
    if (m) {
      // Replace whatever heading level is there (or remove it when equal).
      changes.push({
        from: l.from,
        to: l.from + m[0].length,
        insert: m[1].length === level ? "" : prefix,
      });
    } else {
      changes.push({ from: l.from, to: l.from, insert: prefix });
    }
    if (l.to >= to) break;
    cur = l.to + 1;
  }
  view.dispatch({ changes });
}

/** Insert a blank-line-separated code fence around the selection. */
function insertCodeBlock(view: EditorView, lang: string) {
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to) || "code";
  const inserted = "```" + lang + "\n" + sel + "\n```";
  view.dispatch({ changes: { from, to, insert: inserted } });
}

/** Insert a table at the cursor. */
function insertTable(view: EditorView, cols: number, rows: number) {
  const { from } = view.state.selection.main;
  const header = Array.from({ length: cols }, (_, i) => `Col ${i + 1}`).join(" | ");
  const sep = Array.from({ length: cols }, () => "---").join(" | ");
  const body = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => "").join(" | "),
  ).join("\n");
  const inserted = `| ${header} |\n| ${sep} |\n${body
    .split("\n")
    .map((r) => `| ${r} |`)
    .join("\n")}\n`;
  view.dispatch({ changes: { from, insert: inserted } });
}

/** Toggle a task item on each selected line. */
function toggleTask(view: EditorView, checked: boolean) {
  const { from, to } = view.state.selection.main;
  const marker = checked ? "- [x] " : "- [ ] ";
  const changes: { from: number; to: number; insert: string }[] = [];
  let cur = from;
  while (true) {
    const l = view.state.doc.lineAt(cur);
    const ltext = view.state.sliceDoc(l.from, l.to);
    if (/^\s*-\s+\[[ xX]\]\s+/.test(ltext)) {
      // replace existing marker
      const m = ltext.match(/^(\s*)-\s+\[[ xX]\]\s+/);
      if (m) {
        changes.push({ from: l.from, to: l.from + m[0].length, insert: m[1] + marker });
      }
    } else {
      changes.push({ from: l.from, to: l.from, insert: marker });
    }
    if (l.to >= to) break;
    cur = l.to + 1;
  }
  view.dispatch({ changes });
}

/** Insert an inline link. */
function insertLink(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to) || "text";
  const inserted = `[${sel}](https://)`;
  view.dispatch({
    changes: { from, to, insert: inserted },
    selection: EditorSelection.cursor(from + inserted.length - 1),
  });
}

/** Insert an image. */
function insertImage(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to) || "alt";
  const inserted = `![${sel}](path/to/image.png)`;
  view.dispatch({ changes: { from, to, insert: inserted } });
}

/** Insert a blockquote / unordered / ordered list toggle. */
function toggleList(view: EditorView, kind: "quote" | "bullet" | "ordered") {
  if (kind === "quote") return toggleLinePrefix(view, "> ");
  if (kind === "bullet") return toggleLinePrefix(view, "- ");
  // ordered: toggle numbered prefixes. When every selected line already has a
  // numbered prefix, remove them all; otherwise number only the unnumbered
  // lines incrementally (numbered ones are left untouched).
  const { from, to } = view.state.selection.main;
  const changes: { from: number; to: number; insert: string }[] = [];
  const numbered = (text: string) => /^\s*\d+\.\s+/.test(text);
  const lineTexts: string[] = [];
  let maxN = 0;
  let cur = from;
  while (true) {
    const l = view.state.doc.lineAt(cur);
    const t = view.state.sliceDoc(l.from, l.to);
    lineTexts.push(t);
    const m = t.match(/^\s*(\d+)\.\s+/);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
    if (l.to >= to) break;
    cur = l.to + 1;
  }
  const removing = lineTexts.length > 0 && lineTexts.every(numbered);
  cur = from;
  let n = maxN + 1;
  while (true) {
    const l = view.state.doc.lineAt(cur);
    const ltext = view.state.sliceDoc(l.from, l.to);
    const m = ltext.match(/^(\s*)\d+\.\s+/);
    if (removing) {
      if (m) changes.push({ from: l.from, to: l.from + m[0].length, insert: "" });
    } else if (!m) {
      changes.push({ from: l.from, to: l.from, insert: `${n}. ` });
      n++;
    }
    if (l.to >= to) break;
    cur = l.to + 1;
  }
  view.dispatch({ changes });
}

export type MarkdownCommand =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "heading1"
  | "heading2"
  | "heading3"
  | "codeblock"
  | "table"
  | "task"
  | "taskChecked"
  | "quote"
  | "bullet"
  | "ordered"
  | "link"
  | "image"
  | "toc"
  | "tableFormat";

/** Insert a table of contents at the cursor: one `- [[doc#heading]]` line per
 *  heading, indented by level, so entries are clickable (anchor jump).
 *  Includes ATX (`# …`) and Setext (underlined) headings; skips fenced code
 *  and the TOC block's own `## Contents` marker. */
function insertToc(view: EditorView) {
  const { from } = view.state.selection.main;
  const doc = view.state.doc.toString();
  const rel = view.state.facet(markdownContextFacet)[0]?.docRel ?? "";
  const docStem = (rel.split("/").pop() ?? "note").replace(/\.md$/i, "");
  const lines: string[] = [];
  let inFence = false;
  const srcLines = doc.split("\n");
  for (let i = 0; i < srcLines.length; i++) {
    const line = srcLines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // Setext underline (= H1, - H2): promotes the previous non-blank line.
    const se = /^\s{0,3}(=+|-+)\s*$/.exec(line);
    if (se && i > 0) {
      const prev = srcLines[i - 1];
      if (
        prev.trim() !== "" &&
        !/^\s{0,3}#{1,6}\s/.test(prev) && // already captured as ATX
        !/^\s{0,3}(=+|-+)\s*$/.test(prev) && // underline directly on underline
        !/^\s*([-*+]|\d+\.)\s/.test(prev) // list item + dashes = thematic break
      ) {
        tocPush(lines, docStem, se[1][0] === "=" ? 1 : 2, prev.trim());
      }
      continue;
    }
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    // The TOC block carries its own marker heading; including it would make
    // every regeneration nest a self-reference.
    if (m[1].length === 2 && m[2].trim() === "Contents") continue;
    tocPush(lines, docStem, m[1].length, m[2].trim());
  }
  const body = lines.length > 0 ? lines.join("\n") : "- (no headings)";
  const inserted = `\n## Contents\n\n${body}\n`;
  view.dispatch({ changes: { from, insert: inserted } });
}

/** Format one TOC entry. `|` would be parsed as an alias separator inside
 *  `[[…]]` and zero-width characters break anchor matching, so both are
 *  normalized away before emitting the link. */
function tocPush(out: string[], stem: string, level: number, text: string) {
  const clean = text
    .replace(/\|/g, "/")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .trim();
  if (clean) out.push(`${"  ".repeat(level - 1)}- [[${stem}#${clean}]]`);
}

/** Normalize the table under the cursor (re-pipe + re-space all rows). */
function formatTable(view: EditorView) {
  const { from } = view.state.selection.main;
  const doc = view.state.doc;
  const isTableLine = (t: string) => /^\s*\|/.test(t) || /^\s*:?-{3,}/.test(t);
  let startLine = doc.lineAt(from).number;
  while (startLine > 1 && isTableLine(doc.line(startLine - 1).text)) startLine--;
  let endLine = doc.lineAt(from).number;
  while (endLine < doc.lines && isTableLine(doc.line(endLine + 1).text)) endLine++;
  const start = doc.line(startLine).from;
  const end = doc.line(endLine).to;
  const formatted = formatTableSource(doc.sliceString(start, end));
  if (formatted && formatted !== doc.sliceString(start, end)) {
    view.dispatch({ changes: { from: start, to: end, insert: formatted } });
  }
}

export function runMarkdownCommand(view: EditorView, cmd: MarkdownCommand) {
  switch (cmd) {
    case "bold": return wrap(view, "**", "**");
    case "italic": return wrap(view, "*", "*");
    case "strike": return wrap(view, "~~", "~~");
    case "code": return wrap(view, "`", "`");
    case "heading1": return setHeading(view, 1);
    case "heading2": return setHeading(view, 2);
    case "heading3": return setHeading(view, 3);
    case "codeblock": return insertCodeBlock(view, "");
    case "table": return insertTable(view, 3, 2);
    case "task": return toggleTask(view, false);
    case "taskChecked": return toggleTask(view, true);
    case "quote": return toggleList(view, "quote");
    case "bullet": return toggleList(view, "bullet");
    case "ordered": return toggleList(view, "ordered");
    case "link": return insertLink(view);
    case "image": return insertImage(view);
    case "toc": return insertToc(view);
    case "tableFormat": return formatTable(view);
  }
}
