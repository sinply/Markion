import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import { waitFor } from "@testing-library/react";
import { createEditorState } from "../codemirror";

const sample = `# Heading 1

Some **bold** and *italic* and \`code\` and [link](https://a.com).

![an image](img.png)

> A blockquote

| Col A | Col B |
|-------|-------|
| 1     | 2     |

- [ ] todo
- [x] done

\`\`\`ts
const x: number = 1;
\`\`\`
`;

describe("mounted EditorView renders widgets into DOM", () => {
  it("renders code block, table, task, heading into DOM", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const state = createEditorState(sample, () => {});
    // CM6 parses markdown lazily and renders widgets across rAF/measure
    // cycles; wait until every widget type is actually in the DOM instead of
    // asserting a single frame later (flaky on loaded machines).
    ensureSyntaxTree(state, state.doc.length, 5000);
    const view = new EditorView({ state, parent });

    try {
      await waitFor(
        () => {
          const html = parent.innerHTML;
          const hasCode = html.includes("cm-codeblock") || parent.querySelector("pre") !== null;
          const hasTable = html.includes("cm-table") || parent.querySelector("table") !== null;
          const hasTask = html.includes("cm-task-toggle");
          const hasHeading = html.includes("cm-heading");
          const hasBold = html.includes("cm-emphasis");
          const hasImage = parent.querySelector("img.cm-image") !== null;
          const hasLink = html.includes("cm-link");
          expect({ hasCode, hasTable, hasTask, hasHeading, hasBold, hasImage, hasLink }).toEqual({
            hasCode: true, hasTable: true, hasTask: true, hasHeading: true, hasBold: true,
            hasImage: true, hasLink: true,
          });
        },
        { timeout: 8000 },
      );
    } finally {
      view.destroy();
      document.body.removeChild(parent);
    }
  });
});
