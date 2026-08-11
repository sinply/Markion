# Block Inline-Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layer the live-preview edit interaction so code blocks and tables edit in place (rendered look, no full-block flip), while images/math flip to source only via a persistent corner badge.

**Architecture:** Each block widget type gets a targeted editing affordance. `CodeBlockWidget` wraps its `<code>` in a `contenteditable` that commits to the CM6 doc via `view.dispatch` on blur (debounced). `TableWidget` renders a grid where each `<td>/<th>` is `contenteditable` carrying a `data-source` attribute (injected by a custom markdown-it renderer from the token stream) so cell text edits preserve inline format markers. `ImageWidget` / `MathBlockWidget` / `MathInlineWidget` get a persistent "source" badge; clicking it places the CM6 cursor into the block, flipping it to source via the existing `isOnActiveLine` mechanism.

**Tech Stack:** CodeMirror 6 (`@codemirror/view` `WidgetType`, `Decoration.replace`), markdown-it (custom `td/th` renderer + token stream), vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-08-11-block-inline-editing-design.md`

---

### Task 1: Verify the click-to-source mechanism and current tests pass

**Files:**
- Read: `src/editor/livePreview.ts:433-458` (`handleBlockClick`)
- Test: `src/editor/__tests__/blockClick.test.ts`

- [ ] **Step 1: Confirm the current behavior we're replacing**

The `handleBlockClick` mousedown interceptor (livePreview.ts:433) currently flips code/table blocks to source by placing the CM6 cursor inside them. This plan removes that flip for code/table (they edit in place) and keeps the flip for image/math via a badge. Read the current test to know what behavior exists.

- [ ] **Step 2: Run the current block-click test to establish a baseline**

Run: `cd /d/Exercise/AI/Markion && npx vitest run src/editor/__tests__/blockClick.test.ts`
Expected: 2 tests pass. These will be updated in a later task.

- [ ] **Step 3: Run the full editor test suite**

Run: `npx vitest run src/editor`
Expected: all pass. This is the baseline before changes.

---

### Task 2: Code block edit-in-place — make `CodeBlockWidget` a `contenteditable`

**Files:**
- Modify: `src/editor/widgets.ts:6-45` (`CodeBlockWidget`)
- Test: `src/editor/__tests__/codeBlockInlineEdit.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/editor/__tests__/codeBlockInlineEdit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { createEditorState } from "../codemirror";
import { livePreviewField } from "../livePreview";

const DOC = "before\n\n```js\nlet a = 1;\nlet b = 2;\n```\n\nafter\n";

function mount() {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = createEditorState(DOC, () => {}, { onStateChange: () => {} });
  const view = new EditorView({ state, parent });
  void view.contentDOM.offsetWidth;
  return { view, parent };
}

function widgetCount(state: ReturnType<typeof createEditorState>): number {
  const it = state.field(livePreviewField).iter();
  let n = 0;
  while (it.value) { if (it.value.spec?.widget) n++; it.next(); }
  return n;
}

describe("CodeBlockWidget edit-in-place", () => {
  it("renders the code block as a contenteditable when cursor is away", () => {
    const { view, parent } = mount();
    view.dispatch({ selection: { anchor: DOC.length } });
    const ce = parent.querySelector(".cm-codeblock [contenteditable]");
    expect(ce).not.toBeNull();
    view.destroy();
    document.body.removeChild(parent);
  });

  it("keeps the code block rendered (widget) even when clicked", () => {
    const { view, parent } = mount();
    view.dispatch({ selection: { anchor: DOC.length } });
    // The block should stay a widget (not flip to source) on click.
    const block = parent.querySelector(".cm-codeblock")! as HTMLElement;
    const ev = new MouseEvent("mousedown", { bubbles: true });
    block.dispatchEvent(ev);
    expect(widgetCount(view.state)).toBe(1);
    view.destroy();
    document.body.removeChild(parent);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/editor/__tests__/codeBlockInlineEdit.test.ts`
Expected: FAIL — `.cm-codeblock [contenteditable]` is null (current widget has no contenteditable).

- [ ] **Step 3: Modify `CodeBlockWidget` to render a `contenteditable`**

In `src/editor/widgets.ts`, change `CodeBlockWidget` so the `<code>` element gets `contenteditable="true"` and the widget stores the `view` reference and `block` range for committing edits:

```ts
export class CodeBlockWidget extends WidgetType {
  readonly language: string;
  view: EditorView | null = null;
  blockFrom = 0;
  blockTo = 0;

  constructor(
    readonly code: string,
    lang: string,
  ) {
    super();
    this.language = lang.toLowerCase();
  }

  eq(other: CodeBlockWidget): boolean {
    return other.code === this.code && other.language === this.language;
  }

  toDOM(view: EditorView): HTMLElement {
    // Mermaid diagrams: render as SVG instead of code
    if (this.language === "mermaid") {
      return renderMermaid(this.code);
    }
    this.view = view;
    const pre = document.createElement("pre");
    pre.className = "cm-codeblock";

    if (this.language) {
      const tag = document.createElement("div");
      tag.className = "cm-codeblock-lang";
      tag.textContent = this.language;
      pre.appendChild(tag);
    }

    const code = document.createElement("code");
    code.className = "cm-codeblock-editable";
    code.contentEditable = "true";
    code.textContent = this.code;
    pre.appendChild(code);
    return pre;
  }

  // Ignore mousedown so CM6 does not move its cursor into the block (which
  // would trigger the isOnActiveLine source flip). The contenteditable handles
  // the click itself and takes focus.
  ignoreEvent(e: Event): boolean {
    return e.type === "mousedown" || e.type === "mouseup" || e.type === "click";
  }
}
```

Note: `EditorView` is already imported at the top of widgets.ts.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/editor/__tests__/codeBlockInlineEdit.test.ts`
Expected: PASS (contenteditable present, block stays a widget on mousedown).

- [ ] **Step 5: Commit**

```bash
cd /d/Exercise/AI/Markion
git add src/editor/widgets.ts src/editor/__tests__/codeBlockInlineEdit.test.ts
git commit -m "feat: code block edit-in-place (contenteditable widget, no source flip)"
```

---

### Task 3: Remove the code/table source-flip mousedown interceptor

**Files:**
- Modify: `src/editor/livePreview.ts:430-470` (`handleBlockClick` + `mousedown` handler)

- [ ] **Step 1: Write a failing test (code/table no longer flips on click)**

The existing `blockClick.test.ts` asserts the block flips on mousedown. Update it to assert the OPPOSITE (block stays rendered). Replace the file content:

```ts
import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { createEditorState } from "../codemirror";
import { livePreviewField } from "../livePreview";

const DOC = "text before\n\n```js\nlet a = 1;\nlet b = 2;\nlet c = 3;\n```\n\nafter\n";

function mount() {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = createEditorState(DOC, () => {}, { onStateChange: () => {} });
  const view = new EditorView({ state, parent });
  void view.contentDOM.offsetWidth;
  return { view, parent };
}

function widgetCount(state: ReturnType<typeof createEditorState>): number {
  const it = state.field(livePreviewField).iter();
  let n = 0;
  while (it.value) { if (it.value.spec?.widget) n++; it.next(); }
  return n;
}

describe("code/table block stays rendered on click (edit-in-place)", () => {
  it("renders the code block as a widget when the cursor is away", () => {
    const { view, parent } = mount();
    view.dispatch({ selection: { anchor: DOC.length } });
    expect(widgetCount(view.state)).toBe(1);
    view.destroy();
    document.body.removeChild(parent);
  });

  it("clicking the code block keeps it as a widget (does NOT flip to source)", () => {
    const { view, parent } = mount();
    view.dispatch({ selection: { anchor: DOC.length } });
    const block = parent.querySelector(".cm-codeblock")! as HTMLElement;
    const ev = new MouseEvent("mousedown", { clientY: 60, bubbles: true });
    block.dispatchEvent(ev);
    // After removing the interceptor, the widget stays (no source flip).
    expect(widgetCount(view.state)).toBe(1);
    view.destroy();
    document.body.removeChild(parent);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/editor/__tests__/blockClick.test.ts`
Expected: FAIL — the second test currently flips to source (widget count 0).

- [ ] **Step 3: Remove the mousedown interceptor**

In `src/editor/livePreview.ts`:
1. Delete the `handleBlockClick` function (lines 430-458) entirely — the comment block above it too.
2. Delete the `mousedown` eventHandler (lines 462-470).
3. Remove `SyntaxNode` from imports if now unused.

The `eventHandlers` object becomes:

```ts
export const livePreviewExtension = ViewPlugin.fromClass(LivePlugin, {
  eventHandlers: {
    click(event, view) {
      const target = event.target as HTMLElement;

      // Task checkbox toggle
      if (target.tagName === "INPUT") {
        const label = target.closest(".cm-task-toggle");
        if (!label) return false;
        const pos = view.posAtDOM(target);
        const tree = syntaxTree(view.state);
        const node = tree.resolve(pos, -1);
        if (!node || (node.type.name !== "Task" && node.type.name !== "TaskMarker")) return false;
        let markerNode = node;
        if (node.type.name === "Task") {
          const cur = node.node.cursor();
          if (cur.firstChild()) {
            do {
              if (cur.type.name === "TaskMarker") {
                markerNode = cur.node;
                break;
              }
            } while (cur.nextSibling());
          }
        }
        const text = view.state.doc.sliceString(markerNode.from, markerNode.to);
        const newText = /^\[[xX]\]$/.test(text) ? "[ ]" : "[x]";
        view.dispatch({
          changes: { from: markerNode.from, to: markerNode.to, insert: newText },
        });
        return true;
      }

      // Open external links (also when clicking an image nested inside a link)
      const clickable = target.closest(".cm-image, .cm-link");
      if (clickable) {
        const pos = view.posAtDOM(target);
        const url = resolveLinkUrl(view.state, pos);
        if (url && isExternalUrl(url)) {
          event.preventDefault();
          void openUrl(url);
          return true;
        }
      }

      // Source badge on image/math widgets: flip that block to source.
      const badge = target.closest<HTMLElement>(".cm-source-badge");
      if (badge) {
        const pos = view.posAtDOM(badge);
        const node = syntaxTree(view.state).resolve(pos + 1, -1);
        let block: SyntaxNode | null = node;
        while (block && !["Image", "FencedCode", "CodeBlock", "Table"].includes(block.type.name)) {
          block = block.parent;
        }
        if (!block) return false;
        view.dispatch({ selection: { anchor: block.from }, scrollIntoView: true });
        return true;
      }

      return false;
    },
  },
});
```

Note: this keeps `SyntaxNode` imported (used in the badge handler).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/editor/__tests__/blockClick.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full editor suite + tsc**

Run: `npx vitest run src/editor && npx tsc --noEmit`
Expected: all pass, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/editor/livePreview.ts src/editor/__tests__/blockClick.test.ts
git commit -m "refactor: code/table blocks no longer flip to source on click"
```

---

### Task 4: Image/Math widgets — add a persistent "source" badge

**Files:**
- Modify: `src/editor/widgets.ts` (`ImageWidget`, `MathInlineWidget`, `MathBlockWidget`)
- Modify: `src/styles.css` (badge styles)

- [ ] **Step 1: Write the failing test**

Create `src/editor/__tests__/badge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { createEditorState } from "../codemirror";

const IMG_DOC = "![alt](img.png)\n\nsecond line\n";
const MATH_DOC = "$$\nE = mc^2\n$$\n\nsecond line\n";

function mount(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = createEditorState(doc, () => {}, { onStateChange: () => {} });
  const view = new EditorView({ state, parent });
  void view.contentDOM.offsetWidth;
  return { view, parent };
}

describe("image/math source badge", () => {
  it("image widget renders a source badge", () => {
    const { view, parent } = mount(IMG_DOC);
    view.dispatch({ selection: { anchor: IMG_DOC.length } });
    const badge = parent.querySelector(".cm-source-badge");
    expect(badge).not.toBeNull();
    view.destroy();
    document.body.removeChild(parent);
  });

  it("math block widget renders a source badge", () => {
    const { view, parent } = mount(MATH_DOC);
    view.dispatch({ selection: { anchor: MATH_DOC.length } });
    const badge = parent.querySelector(".cm-source-badge");
    expect(badge).not.toBeNull();
    view.destroy();
    document.body.removeChild(parent);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/editor/__tests__/badge.test.ts`
Expected: FAIL — no `.cm-source-badge` exists.

- [ ] **Step 3: Add a badge helper and wire it into the widgets**

In `src/editor/widgets.ts`, add a shared helper and call it from `ImageWidget`, `MathInlineWidget`, and `MathBlockWidget`'s `toDOM`:

```ts
/** Small persistent "source" badge that flips this block to raw source when
 *  clicked. The actual flip is handled in livePreview.ts's click handler. */
function appendSourceBadge(container: HTMLElement): void {
  const badge = document.createElement("span");
  badge.className = "cm-source-badge";
  badge.textContent = "source";
  badge.title = "Edit source";
  container.appendChild(badge);
}
```

For `ImageWidget.toDOM`, after `wrap.appendChild(img);` add `appendSourceBadge(wrap);`.

For `MathInlineWidget.toDOM`, after the katex span setup, add `appendSourceBadge(span);`.

For `MathBlockWidget.toDOM`, after the div setup, add `appendSourceBadge(div);`.

Note: inline math (`MathInlineWidget`) is inline; a badge on it may be visually tight but acceptable. If it proves awkward, the plan's later review can restrict badges to block widgets — but per spec all image/math get a badge.

- [ ] **Step 4: Add badge CSS**

In `src/styles.css`, add:

```css
/* Source badge on image/math widgets */
.cm-image-wrap, .cm-math-inline, .cm-math-block {
  position: relative;
}
.cm-source-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 10px;
  color: var(--fg-muted);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 0 4px;
  cursor: pointer;
  opacity: 0.7;
  line-height: 1.4;
  user-select: none;
}
.cm-source-badge:hover {
  opacity: 1;
  color: var(--accent);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/editor/__tests__/badge.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full suite + tsc**

Run: `npx vitest run src/editor && npx tsc --noEmit`
Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/editor/widgets.ts src/styles.css src/editor/__tests__/badge.test.ts
git commit -m "feat: source badge on image/math widgets flips block to source"
```

---

### Task 5: Table edit-in-place — `data-source` injection + editable cells

This is the most complex task. It has two parts: (A) inject `data-source` into rendered cells via a custom markdown-it renderer, and (B) make cells `contenteditable` and serialize edits back to pipe syntax.

**Files:**
- Modify: `src/editor/markdown.ts` (add table renderer with `data-source`)
- Modify: `src/editor/widgets.ts` (`TableWidget`)
- Test: `src/editor/__tests__/tableInlineEdit.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/editor/__tests__/tableInlineEdit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { createEditorState } from "../codemirror";
import { renderMarkdownWithTableSource } from "../markdown";

describe("table data-source injection", () => {
  it("renders each cell with a data-source attribute carrying the inline source", () => {
    const html = renderMarkdownWithTableSource("| A | B |\n| --- | --- |\n| *em* | `code` |");
    expect(html).toContain('data-source="*em*"');
    expect(html).toContain(">em</td>"); // rendered text still em
  });

  it("preserves alignment markers", () => {
    const html = renderMarkdownWithTableSource("| A | B |\n| :--- | ---: |\n| x | y |");
    expect(html).toContain('style="text-align:left"');
    expect(html).toContain('style="text-align:right"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/editor/__tests__/tableInlineEdit.test.ts`
Expected: FAIL — `renderMarkdownWithTableSource` is not defined.

- [ ] **Step 3: Add `renderMarkdownWithTableSource` to markdown.ts**

In `src/editor/markdown.ts`, add a renderer variant that injects `data-source` into `td`/`th`:

```ts
/** Render markdown to HTML, injecting each table cell's raw inline source as a
 *  `data-source` attribute. The token stream preserves cell source (e.g. `*em*`)
 *  that the rendered HTML drops, so table edit-in-place can preserve formats. */
export function renderMarkdownWithTableSource(src: string): string {
  const thDefault = md.renderer.rules.th_open ?? ((tokens: any, i: number, options: any, env: any, self: any) => self.renderToken(tokens, i, options));
  const tdDefault = md.renderer.rules.td_open ?? ((tokens: any, i: number, options: any, env: any, self: any) => self.renderToken(tokens, i, options));
  md.renderer.rules.th_open = (tokens: any, idx: number, options: any, env: any, self: any) => {
    const token = tokens[idx];
    const next = tokens[idx + 1];
    if (next && next.type === "inline") token.attrSet("data-source", next.content);
    return thDefault(tokens, idx, options, env, self);
  };
  md.renderer.rules.td_open = (tokens: any, idx: number, options: any, env: any, self: any) => {
    const token = tokens[idx];
    const next = tokens[idx + 1];
    if (next && next.type === "inline") token.attrSet("data-source", next.content);
    return tdDefault(tokens, idx, options, env, self);
  };
  return md.render(src);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/editor/__tests__/tableInlineEdit.test.ts`
Expected: PASS.

- [ ] **Step 5: Modify `TableWidget` to use the source-injected renderer and editable cells**

Replace the `TableWidget` class in `src/editor/widgets.ts`:

```ts
export class TableWidget extends WidgetType {
  view: EditorView | null = null;
  blockFrom = 0;
  blockTo = 0;

  constructor(readonly raw: string) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.raw === this.raw;
  }

  toDOM(view: EditorView): HTMLElement {
    this.view = view;
    const div = document.createElement("div");
    div.className = "cm-table";
    div.innerHTML = renderMarkdownWithTableSource(this.raw);
    // Make each cell editable; edits are committed to the CM6 doc on blur.
    div.querySelectorAll("td, th").forEach((cell) => {
      cell.setAttribute("contenteditable", "true");
    });
    div.addEventListener("blur", () => {
      if (!this.view || !this.blockFrom || !this.blockTo) return;
      const newSource = serializeTableCells(div);
      if (newSource && newSource !== this.raw) {
        this.view.dispatch({
          changes: { from: this.blockFrom, to: this.blockTo, insert: newSource },
        });
      }
    }, true);
    return div;
  }

  ignoreEvent(e: Event): boolean {
    return e.type === "mousedown" || e.type === "mouseup" || e.type === "click";
  }
}
```

- [ ] **Step 6: Add `serializeTableCells` helper + table cell matrix serialization**

Add to `src/editor/widgets.ts` (after `TableWidget`):

```ts
/** Serialize the editable table DOM back into GFM pipe syntax. Each cell's
 *  `data-source` holds its raw inline source; if a cell's text is unchanged we
 *  write the source verbatim (preserving escaped pipes / format markers). */
function serializeTableCells(tableEl: HTMLElement): string {
  const rows: HTMLElement[][] = [];
  tableEl.querySelectorAll("tr").forEach((tr) => {
    rows.push(Array.from(tr.querySelectorAll("th, td")) as HTMLElement[]);
  });
  if (rows.length === 0) return "";
  const header = rows[0].map(cellText);
  const body = rows.slice(1).map((r) => r.map(cellText));
  const align = detectAlign(tableEl);
  return [pipeRow(header), alignRow(align), ...body.map((r) => pipeRow(r))].join("\n");
}

function cellText(cell: HTMLElement): string {
  const src = cell.getAttribute("data-source") ?? "";
  const text = (cell.textContent ?? "").trim();
  // If the cell was edited, try to preserve a simple format wrap from data-source.
  return preserveWrap(src, text);
}

/** If data-source was a simple marker wrap (*x*, `x`, **x**) and only the inner
 *  text changed, re-wrap. Otherwise return plain text. */
function preserveWrap(src: string, newText: string): string {
  const m = /^(\*{1,2}|`|_{1,2}|~~)([\s\S]*?)\1$/.exec(src);
  if (m && m[2] !== newText) return m[1] + newText + m[1];
  if (src === newText) return src; // unchanged → keep source verbatim
  return newText; // ambiguous / no wrap → plain text (never corrupts)
}

function pipeRow(cells: string[]): string {
  return "| " + cells.join(" | ") + " |";
}

function detectAlign(tableEl: HTMLElement): string[] {
  const firstRow = tableEl.querySelector("tr");
  if (!firstRow) return [];
  return Array.from(firstRow.querySelectorAll("th, td")).map((cell) => {
    const style = (cell as HTMLElement).style.textAlign;
    if (style === "right") return "---:";
    if (style === "center") return ":---:";
    return "---";
  });
}

function alignRow(align: string[]): string {
  return "| " + align.join(" | ") + " |";
}
```

- [ ] **Step 7: Pass block range to `TableWidget`**

The widget needs `blockFrom`/`blockTo` to commit edits. In `src/editor/livePreview.ts` where `TableWidget` is constructed (around line 324), pass the node range:

```ts
const raw = state.doc.sliceString(node.from, node.to);
const tableWidget = new TableWidget(raw);
tableWidget.blockFrom = node.from;
tableWidget.blockTo = node.to;
entries.push({
  from: node.from, to: node.to,
  decoration: Decoration.replace({ widget: tableWidget, block: true }),
});
```

- [ ] **Step 8: Test that editing a cell preserves format and serializes back**

Add to `src/editor/__tests__/tableInlineEdit.test.ts`:

```ts
import { renderMarkdownWithTableSource } from "../markdown";
import { serializeTableCells } from "../widgets";

describe("TableWidget serialize", () => {
  it("renders editable cells", () => {
    const div = document.createElement("div");
    div.innerHTML = renderMarkdownWithTableSource("| A | B |\n| --- | --- |\n| *em* | `code` |");
    expect(div.querySelectorAll('[contenteditable="true"]').length).toBe(4);
  });

  it("preserves a format wrap when a cell's inner text is edited", () => {
    const div = document.createElement("div");
    div.innerHTML = renderMarkdownWithTableSource("| A | B |\n| --- | --- |\n| *em* | `code` |");
    // change the first body cell text from 'em' to 'em!'
    const firstBodyCell = div.querySelector("tbody td") as HTMLElement;
    firstBodyCell.textContent = "em!";
    const out = serializeTableCells(div);
    expect(out).toContain("*em!*");
    expect(out).toContain("`code`");
  });
});
```

Note: `serializeTableCells` must be exported from `src/editor/widgets.ts` (make it `export function serializeTableCells`).

Run: `npx vitest run src/editor/__tests__/tableInlineEdit.test.ts`
Expected: PASS.

- [ ] **Step 9: Run full suite + tsc**

Run: `npx vitest run src/editor && npx tsc --noEmit`
Expected: pass.

- [ ] **Step 10: Commit**

```bash
git add src/editor/markdown.ts src/editor/widgets.ts src/editor/livePreview.ts src/editor/__tests__/tableInlineEdit.test.ts
git commit -m "feat: table edit-in-place via data-source cells + serialization"
```

---

### Task 6: Code block commit-on-blur + block range wiring

**Files:**
- Modify: `src/editor/widgets.ts` (`CodeBlockWidget.toDOM` — commit on blur)
- Modify: `src/editor/livePreview.ts` (pass block range to CodeBlockWidget)

- [ ] **Step 1: Write the failing test**

In `src/editor/__tests__/codeBlockInlineEdit.test.ts`, add:

```ts
import { CodeBlockWidget } from "../widgets";

describe("CodeBlockWidget commit-on-blur", () => {
  it("commits edited code back to the document on blur", () => {
    const { view, parent } = mount();
    view.dispatch({ selection: { anchor: DOC.length } });
    const ce = parent.querySelector(".cm-codeblock [contenteditable]") as HTMLElement;
    ce.textContent = "let a = 99;\nlet b = 2;";
    ce.dispatchEvent(new Event("blur"));
    const docText = view.state.doc.toString();
    expect(docText).toContain("let a = 99;");
    expect(docText).not.toContain("let a = 1;");
    view.destroy();
    document.body.removeChild(parent);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/editor/__tests__/codeBlockInlineEdit.test.ts`
Expected: FAIL — blur does nothing yet (no commit handler).

- [ ] **Step 3: Add commit-on-blur to `CodeBlockWidget.toDOM`**

In `src/editor/widgets.ts`, extend `CodeBlockWidget.toDOM` to commit on blur:

```ts
  toDOM(view: EditorView): HTMLElement {
    if (this.language === "mermaid") {
      return renderMermaid(this.code);
    }
    this.view = view;
    const pre = document.createElement("pre");
    pre.className = "cm-codeblock";

    if (this.language) {
      const tag = document.createElement("div");
      tag.className = "cm-codeblock-lang";
      tag.textContent = this.language;
      pre.appendChild(tag);
    }

    const code = document.createElement("code");
    code.className = "cm-codeblock-editable";
    code.contentEditable = "true";
    code.textContent = this.code;
    pre.appendChild(code);

    // Commit the edited code back to the document when the user leaves the block.
    code.addEventListener("blur", () => {
      if (!this.view || !this.blockFrom || !this.blockTo) return;
      const newCode = code.textContent ?? "";
      const lang = this.language;
      const newSource = "```" + lang + "\n" + newCode + "\n```";
      if (newSource !== this.code) {
        this.view.dispatch({
          changes: { from: this.blockFrom, to: this.blockTo, insert: newSource },
        });
      }
    });
    return pre;
  }
```

- [ ] **Step 4: Pass block range to `CodeBlockWidget`**

In `src/editor/livePreview.ts` where `CodeBlockWidget` is constructed (around line 311):

```ts
const codeWidget = new CodeBlockWidget(codeLines, infoLine);
codeWidget.blockFrom = node.from;
codeWidget.blockTo = node.to;
entries.push({
  from: node.from, to: node.to,
  decoration: Decoration.replace({ widget: codeWidget, block: true }),
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/editor/__tests__/codeBlockInlineEdit.test.ts`
Expected: PASS (both the contenteditable test and the commit-on-blur test).

- [ ] **Step 6: Run full suite + tsc**

Run: `npx vitest run src/editor && npx tsc --noEmit`
Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/editor/widgets.ts src/editor/livePreview.ts src/editor/__tests__/codeBlockInlineEdit.test.ts
git commit -m "feat: code block commits edits to the document on blur"
```

---

### Task 7: Update `livePreview.test.ts` and `mount-render.test.ts` for new widget behavior

**Files:**
- Modify: `src/editor/__tests__/livePreview.test.ts` (tests that expected source flip)
- Modify: `src/editor/__tests__/mount-render.test.ts` (checks widgets still render)

- [ ] **Step 1: Run the full editor suite to find breakages**

Run: `npx vitest run src/editor`
Expected: identify tests that asserted the old flip-to-source behavior for code/table.

- [ ] **Step 2: Fix any tests that expected code/table to flip on click**

Search for tests asserting `hasWidget` becomes false when cursor is on a code/table line, or tests relying on `handleBlockClick`. Update them to assert the widget stays (edit-in-place). For example, `livePreview.test.ts` "replaces a fenced code block with a widget" should still pass (widget present when cursor away). Tests that move the cursor onto the block line and expect the widget to vanish must be updated to expect the widget stays.

- [ ] **Step 3: Update `mount-render.test.ts` if needed**

The sample doc includes a code block, table, task, heading. After changes, verify the mounted view still renders all widgets. It should pass unchanged — run it.

- [ ] **Step 4: Run full suite + tsc**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/editor/__tests__/
git commit -m "test: update editor tests for edit-in-place behavior"
```

---

### Task 8: Manual verification in the real app + release build

**Files:**
- No code changes (verification only)

- [ ] **Step 1: Build and run the app**

Run: `cd /d/Exercise/AI/Markion && npm run tauri build -- --no-bundle`
This builds the release exe with all changes.

- [ ] **Step 2: Manual test — code block edit-in-place**

Open a note with a code block. Click the code block — it should stay rendered (highlighted) with the text editable. Edit text, click away — the document should update (source changed).

- [ ] **Step 3: Manual test — table edit-in-place**

Open a note with a table. Click a cell — it becomes editable. Type in the cell. Click away — the table re-renders with the new content, inline formats preserved.

- [ ] **Step 4: Manual test — image/math badge**

Open a note with an image and a math block. Each should show a small "source" badge in its corner. Click the badge — the block flips to source for editing. Click away — it re-renders.

- [ ] **Step 5: Confirm no white screen**

The exe loads `http://tauri.localhost` (embedded frontend). Launch the exe standalone — it must not white-screen.

---

### Task 9: Bump version, update README, finalize

**Files:**
- Modify: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.lock`, `src/components/AboutDialog.tsx`

- [ ] **Step 1: Bump patch version 0.8.6 → 0.8.7**

```bash
cd /d/Exercise/AI/Markion
sed -i 's/"version": "0.8.6"/"version": "0.8.7"/' package.json
sed -i 's/^version = "0.8.6"/version = "0.8.7"/' src-tauri/Cargo.toml
sed -i 's/"version": "0.8.6"/"version": "0.8.7"/' src-tauri/tauri.conf.json
sed -i 's/const VERSION = "0.8.6";/const VERSION = "0.8.7";/' src/components/AboutDialog.tsx
# Cargo.lock markion entry
python3 -c "import re; p='src-tauri/Cargo.lock'; s=open(p,encoding='utf-8').read(); open(p,'w',encoding='utf-8').write(s.replace('name = \"markion\"\nversion = \"0.8.6\"','name = \"markion\"\nversion = \"0.8.7\"'))"
```

- [ ] **Step 2: Rebuild release exe**

Run: `npm run tauri build -- --no-bundle`
Verify: built at `src-tauri/target/release/markion.exe`.

- [ ] **Step 3: Run full test suite one final time**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/Cargo.lock src/components/AboutDialog.tsx
git commit -m "chore: bump version to 0.8.7"
```

- [ ] **Step 5: Push and release**

Push to main and, if this is a significant feature, create a GitHub release with the built exe. Per CLAUDE.md: only create a release for significant, bug-free feature versions; otherwise just push code.
