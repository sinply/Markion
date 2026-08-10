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
  tree.iterate({
    enter(node) {
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
          }}
        >
          {h.text}
        </div>
      ))}
    </div>
  );
}
