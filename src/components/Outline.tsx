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
      if (node.type.name !== "Heading") return;
      let level = 1;
      const cursor = node.node.cursor();
      if (cursor.firstChild()) {
        do {
          if (cursor.node.type.name === "Mark") level++;
        } while (cursor.nextSibling());
      }
      const raw = state.doc.sliceString(node.from, node.to);
      const text = raw.replace(/^#+\s*/, "").trim();
      headings.push({ level: Math.min(level, 6), text, from: node.from });
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
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 12, color: "#666" }}>OUTLINE</div>
      {headings.length === 0 && (
        <div style={{ color: "#999" }}>No headings</div>
      )}
      {headings.map((h, i) => (
        <div
          key={i}
          onClick={() => onJump(h.from)}
          style={{
            padding: "2px 0",
            paddingLeft: (h.level - 1) * 12,
            cursor: "pointer",
            color: "#333",
          }}
        >
          {h.text}
        </div>
      ))}
    </div>
  );
}
