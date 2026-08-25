import { useMemo, useState } from "react";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

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

/** Source range of the heading block at `index`: the heading line up to the
 *  next heading of the same or higher level (or end of doc). */
export function headingBlockRange(state: EditorState, index: number): { from: number; to: number } | null {
  const headings = extractHeadings(state);
  if (index < 0 || index >= headings.length) return null;
  const src = headings[index];
  let end = state.doc.length;
  for (let i = index + 1; i < headings.length; i++) {
    if (headings[i].level <= src.level) {
      end = headings[i].from;
      break;
    }
  }
  return { from: src.from, to: end };
}

/** Result of a drag-to-reorder: delete the source block, then insert it right
 *  after the target block. Applied as TWO dispatches (the insert position is
 *  in the post-delete document, so a single change array would overlap). */
export interface HeadingMove {
  delete: { from: number; to: number };
  insertAt: number;
  insert: string;
}

/** Changes that move the heading block at `from` to just after the block at
 *  `to` (drag-to-reorder in the outline). Returns null when invalid. */
export function moveHeadingBlock(state: EditorState, from: number, to: number): HeadingMove | null {
  if (from === to) return null;
  const src = headingBlockRange(state, from);
  if (!src) return null;
  const headings = extractHeadings(state);
  if (to < 0 || to >= headings.length) return null;
  const toRange = headingBlockRange(state, to);
  if (!toRange) return null;
  const blockText = state.doc.sliceString(src.from, src.to);
  const blockLen = src.to - src.from;
  // Insert AFTER the target block (drop-on-target = place after it). When
  // moving down, the deletion shifts the target's end left by blockLen, which
  // is exactly where the insert should go in the post-delete document.
  // Clamp to the post-delete length: a target block reaching the end of the
  // doc makes toRange.to == doc length, and after deleting blockLen the doc is
  // shorter — an insertAt past it would throw "Position out of range".
  const postDeleteLen = state.doc.length - blockLen;
  const insertAt = Math.min(to > from ? toRange.to - blockLen : toRange.to, postDeleteLen);
  return {
    delete: { from: src.from, to: src.to },
    insertAt,
    insert: blockText,
  };
}

interface OutlineProps {
  state: EditorState | null;
  onJump: (from: number) => void;
}

export function OutlinePane({ state, onJump }: OutlineProps) {
  const headings = useMemo(() => (state ? extractHeadings(state) : []), [state]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const move = (to: number) => {
    if (dragIdx === null || dragIdx === to) {
      setDragIdx(null);
      return;
    }
    if (!state) return;
    const el = document.querySelector(".cm-editor .cm-content") as HTMLElement | null;
    const view = el ? EditorView.findFromDOM(el) : null;
    if (view) {
      const move = moveHeadingBlock(view.state, dragIdx, to);
      if (move) {
        // Two dispatches: the insert position is in the post-delete document.
        view.dispatch({ changes: { from: move.delete.from, to: move.delete.to, insert: "" } });
        view.dispatch({ changes: { from: move.insertAt, to: move.insertAt, insert: move.insert } });
      }
    }
    setDragIdx(null);
  };

  return (
    <div style={{ padding: 8, overflow: "auto", fontSize: 13 }}>
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 12, color: "var(--fg-muted)" }}>OUTLINE</div>
      {headings.length === 0 && (
        <div style={{ color: "var(--fg-muted)" }}>No headings</div>
      )}
      {headings.map((h, i) => (
        <div
          key={i}
          draggable
          onDragStart={() => setDragIdx(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => move(i)}
          onClick={() => onJump(h.from)}
          style={{
            padding: "2px 0",
            paddingLeft: (h.level - 1) * 12,
            cursor: "pointer",
            color: "var(--fg)",
            fontSize: h.level === 1 ? 14 : h.level === 2 ? 13 : 12,
            fontWeight: h.level <= 2 ? 600 : 400,
            opacity: dragIdx === i ? 0.4 : 1,
          }}
        >
          {h.text}
        </div>
      ))}
    </div>
  );
}
