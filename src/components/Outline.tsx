import { useMemo } from "react";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

interface Heading {
  level: number;
  text: string;
  from: number;
}

export function extractHeadings(state: EditorState): Heading[] {
  const tree = syntaxTree(state);
  const headings: Heading[] = [];

  // The doc-leading YAML frontmatter (`---...---`) is parsed by Lezer as a
  // SetextHeading, so find its end offset and skip everything inside it.
  let fmEnd = 0;
  const docText = state.doc.toString();
  const fm = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(docText);
  if (fm) fmEnd = fm[0].length;

  tree.iterate({
    enter(node) {
      // Only filter out heading nodes that start inside the frontmatter;
      // don't skip the Document node (that would hide every heading).
      if (node.from < fmEnd) return true;
      const name = node.type.name;
      const m = name.match(/^(?:ATX|Setext)Heading(\d)$/);
      if (!m) return;
      const level = Math.min(parseInt(m[1], 10), 6);
      const raw = state.doc.sliceString(node.from, node.to);
      const text = raw.replace(/^#+\s*/, "").trim();
      headings.push({ level, text, from: node.from });
      return false;
    },
  });
  return headings;
}

interface OutlineProps {
  state: EditorState | null;
  onJump: (from: number) => void;
}

export function OutlinePane({ state, onJump }: OutlineProps) {
  const headings = useMemo(() => (state ? extractHeadings(state) : []), [state]);

  return (
    <div style={{ padding: 8, overflow: "auto", fontSize: 13 }}>
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 12, color: "var(--fg-muted)" }}>OUTLINE</div>
      {headings.length === 0 && (
        <div style={{ color: "var(--fg-muted)" }}>No headings</div>
      )}
      {headings.map((h, i) => (
        <div
          key={i}
          onClick={() => onJump(h.from)}
          style={{
            padding: "2px 0",
            paddingLeft: (h.level - 1) * 12,
            cursor: "pointer",
            color: "var(--fg)",
            fontSize: h.level === 1 ? 14 : h.level === 2 ? 13 : 12,
            fontWeight: h.level <= 2 ? 600 : 400,
          }}
        >
          {h.text}
        </div>
      ))}
    </div>
  );
}
