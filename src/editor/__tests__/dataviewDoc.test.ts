import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import { waitFor } from "@testing-library/react";
import { createEditorState } from "../codemirror";

const USER_DOC = `## 一、Study Notes

### 1. SDR软件无线电
\`\`\`dataview
table file.mtime AS "修改时间", file.size AS "字节大小"
from "FPGA Notes/Study Notes/SDR软件无线电"
sort  file.name asc
\`\`\`

### 2. FPGA学习笔记 — 基础课程
\`\`\`dataview
table file.mtime AS "修改时间", file.size AS "字节大小"
from "FPGA Notes/Study Notes/FPGA学习笔记/基础知识"
sort  file.name asc
\`\`\`
\`\`\`dataview
table file.mtime AS "修改时间", file.size AS "字节大小"
from "FPGA Notes/Study Notes/FPGA学习笔记/基础项目"
sort  file.name asc
\`\`\`
\`\`\`dataview
table file.mtime AS "修改时间", file.size AS "字节大小"
from "FPGA Notes/Study Notes/FPGA学习笔记/基础实验"
sort  file.name asc
\`\`\`
`;

function visibleText(parent: HTMLElement): string {
  const clone = parent.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".cm-hidden, .cm-gutters").forEach((el) => el.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ");
}

describe("user doc: headings + consecutive dataview fences", () => {
  it("renders headings and all four fence blocks without decoration failure", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const state = createEditorState(USER_DOC, () => {});
    ensureSyntaxTree(state, state.doc.length, 5000);
    const view = new EditorView({ state, parent });
    view.dispatch({ selection: { anchor: state.doc.length } });
    try {
      await waitFor(() => {
        // Headings render
        expect(parent.querySelectorAll(".cm-heading").length).toBeGreaterThanOrEqual(3);
        // Every dataview fence renders as a dataview widget (jsdom has no
        // Tauri IPC, so the widget settles into its error/loading card —
        // what matters is that it is a WIDGET, not bare source).
        expect(parent.querySelectorAll(".cm-dataview").length).toBe(4);
      }, { timeout: 8000 });
      const text = visibleText(parent);
      expect(text).toContain("SDR软件无线电");
      // The DQL source is replaced by the widget — no bare query text/fences.
      expect(text).not.toContain("```");
      expect(text).not.toContain("file.mtime");
      expect(text).not.toContain("sort");
    } finally {
      view.destroy();
      parent.remove();
    }
  });

  it("cursor inside a dataview fence keeps raw source editable", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const state = createEditorState(USER_DOC, () => {});
    ensureSyntaxTree(state, state.doc.length, 5000);
    const view = new EditorView({ state, parent });
    view.dispatch({ selection: { anchor: DOC_IN_FIRST_FENCE } });
    try {
      await waitFor(() => {
        expect(visibleText(parent)).toContain("```");
      }, { timeout: 8000 });
    } finally {
      view.destroy();
      parent.remove();
    }
  });
});

const DOC_IN_FIRST_FENCE = USER_DOC.indexOf("file.mtime");
