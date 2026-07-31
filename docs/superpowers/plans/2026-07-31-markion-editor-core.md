# Markion Editor Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Obsidian-style live preview editor using CodeMirror 6 — source-as-truth with real-time decorations for inline and block markdown elements, plus a minimal React wrapper for testing.

**Architecture:** A CM6 `ViewPlugin` walks the Lezer syntax tree for visible ranges, emitting `Decoration.mark` (hiding syntax markers like `**` and backticks) and `Decoration.replace` + `WidgetType` (replacing tables, code blocks, task items with rendered HTML). A React component mounts CM6 via a ref. Markdown-it handles block-level HTML rendering; lowlight does code highlighting.

**Tech Stack:** CodeMirror 6 (`@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/lang-markdown`), `@lezer/markdown`, `markdown-it` + GFM plugins, `lowlight`, React, vitest + jsdom.

**Spec reference:** [2026-07-31-markion-editor-design.md](../specs/2026-07-31-markion-editor-design.md) — section 4 (editor core).

---

## File Structure (this plan)

| File | Responsibility |
|---|---|
| `src/editor/markdown.ts` | markdown-it instance with GFM + lowlight code highlighting |
| `src/editor/codemirror.ts` | `createEditorState(doc, onChange)` factory; extensions bundle including markdown language + live preview plugin |
| `src/editor/livePreview.ts` | `ViewPlugin.fromClass` that walks Lezer tree for visible ranges and builds `DecorationSet` |
| `src/editor/widgets.ts` | `WidgetType` subclasses: `CodeBlockWidget`, `TableWidget`, `TaskCheckboxWidget` |
| `src/editor/EditorView.tsx` | React component: mounts CM6 via ref; props: `{ doc, onChange, theme? }`; imperative `getDoc()`/`setDoc()` via `useImperativeHandle` |
| `src/editor/__tests__/markdown.test.ts` | Unit tests for markdown-it rendering |
| `src/editor/__tests__/livePreview.test.ts` | Decoration-output snapshot tests for various markdown inputs |
| `src/editor/__tests__/widgets.test.ts` | Widget behavior tests (checkbox toggle rewrites source) |

### Shared contracts (from Plan 1)

- TS types in `src/lib/types.ts`
- IPC wrappers in `src/lib/ipc.ts`
- Dependencies already in `package.json` from Plan 1 scaffold

---

## Task 1: Add editor npm dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install editor packages**

```bash
npm install codemirror @codemirror/state @codemirror/view @codemirror/language @codemirror/lang-markdown @lezer/markdown @lezer/highlight markdown-it @types/markdown-it markdown-it-gfm markdown-it-task-lists lowlight
```

- [ ] **Step 2: Install dev dependencies for testing**

```bash
npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 3: Add vitest config**

Modify `vite.config.ts` to include the `test` block if not present, or create a minimal vitest config section. If `vite.config.ts` already exports a config, add:

```ts
/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
  },
});
```

- [ ] **Step 4: Verify dev build still works**

```bash
npm run dev
```

Expected: Vite dev server starts (though the editor isn't wired yet).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.ts
git commit -m "chore: add CM6, markdown-it, lowlight, vitest deps"
```

---

## Task 2: markdown-it config with GFM + code highlighting (TDD)

**Files:**
- Create: `src/editor/markdown.ts`
- Create: `src/editor/__tests__/markdown.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/editor/__tests__/markdown.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../markdown";

describe("renderMarkdown", () => {
  it("renders GFM tables", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    const html = renderMarkdown(md);
    expect(html).toContain("<table>");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>1</td>");
  });

  it("renders task list items with checkboxes", () => {
    const md = "- [ ] todo\n- [x] done\n";
    const html = renderMarkdown(md);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked');
    expect(html).toContain("disabled");
  });

  it("renders strikethrough", () => {
    const html = renderMarkdown("~~deleted~~");
    expect(html).toContain("<s>deleted</s>");
  });

  it("renders fenced code blocks with language class", () => {
    const md = '```javascript\nconst x = 1;\n```\n';
    const html = renderMarkdown(md);
    expect(html).toContain("language-javascript");
    expect(html).toContain("<code>");
    expect(html).toContain("const x = 1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/editor/__tests__/markdown.test.ts
```

Expected: FAIL — `Cannot find module '../markdown'`.

- [ ] **Step 3: Implement markdown.ts**

Create `src/editor/markdown.ts`:

```ts
import MarkdownIt from "markdown-it";
import MarkdownItGfm from "markdown-it-gfm";
import MarkdownItTaskLists from "markdown-it-task-lists";
import { common, createLowlight } from "lowlight";

const lowlight = createLowlight(common);
const md = new MarkdownIt({ html: false, linkify: true, typographer: false })
  .use(MarkdownItGfm)
  .use(MarkdownItTaskLists);

md.options.highlight = (str: string, lang: string) => {
  if (lang && lowlight.registered(lang)) {
    try {
      return lowlight.highlight(lang, str).value;
    } catch {
      return "";
    }
  }
  return "";
};

export function renderMarkdown(src: string): string {
  return md.render(src);
}

/** Render inline markdown only (no block wrapper like <p>) */
export function renderMarkdownInline(src: string): string {
  return md.renderInline(src);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/editor/__tests__/markdown.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/editor/markdown.ts src/editor/__tests__/markdown.test.ts
git commit -m "feat(editor): markdown-it with GFM, task lists, lowlight code highlighting"
```

---

## Task 3: CM6 editor factory with markdown extensions (TDD)

**Files:**
- Create: `src/editor/codemirror.ts`
- Modify: `src/editor/codemirror.ts` (add tests inline)

- [ ] **Step 1: Write a minimal test that creates a markdown EditorState**

Append to the bottom of `src/editor/codemirror.ts` (temporarily; tests move later). Actually, create `src/editor/codemirror.ts` with both the factory and an inline test:

```ts
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap } from "@codemirror/commands";
import { Compartment } from "@codemirror/state";

const themeCompartment = new Compartment();

export function createEditorState(
  doc: string,
  onChange: (doc: string) => void,
): EditorState {
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      onChange(update.state.doc.toString());
    }
  });

  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      markdown(),
      keymap.of(defaultKeymap),
      updateListener,
      themeCompartment.of(EditorView.theme({})),
    ],
  });
}

export { themeCompartment };
```

No separate test for now — this factory is tested indirectly via Task 7 (React wrapper) and Task 8 (integration smoke).

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/editor/codemirror.ts
git commit -m "feat(editor): CM6 editor factory with markdown language"
```

---

## Task 4: Live preview ViewPlugin — inline decorations (TDD)

**Files:**
- Create: `src/editor/livePreview.ts`
- Create: `src/editor/__tests__/livePreview.test.ts`

- [ ] **Step 1: Write failing decoration tests**

Create `src/editor/__tests__/livePreview.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { livePreviewExtension, LivePreviewPlugin } from "../livePreview";
import { syntaxTree } from "@codemirror/language";

function createView(doc: string): { view: EditorView; plugin: any } {
  const parent = document.createElement("div");
  const state = EditorState.create({
    doc,
    extensions: [markdown(), viewportDemoExt],
  });
  // Add the live preview extension too. For testing, we'll test the plugin class directly.
  // Actually, install the extension to get the plugin instance.
  const state2 = EditorState.create({
    doc,
    extensions: [markdown(), livePreviewExtension],
  });
  const view = new EditorView({ state: state2, parent });
  const plugin = view.plugin(LivePreviewPlugin);
  // Return view and plugin for inspection
  return { view, plugin: plugin as any };
}

describe("live preview decorations", () => {
  it("hides bold markers (**)", () => {
    const { plugin } = createView("**bold** text");
    const decos = plugin!.decorations;
    expect(decos).toBeDefined();
    // There should be decorations hiding the ** markers
    const iter = decos.iter();
    const hidden: { from: number; to: number }[] = [];
    while (iter.value) {
      if (iter.value.spec?.attributes?.class?.includes?.("cm-hidden-marker")) {
        hidden.push({ from: iter.from, to: iter.to });
      }
      iter.next();
    }
    expect(hidden.length).toBeGreaterThanOrEqual(2); // opening ** and closing **
  });

  it("hides inline code backticks", () => {
    const { plugin } = createView("`code` word");
    const decos = plugin!.decorations;
    const iter = decos.iter();
    let hasHidden = false;
    while (iter.value) {
      if (iter.value.spec?.attributes?.class?.includes?.("cm-hidden-marker")) {
        hasHidden = true;
      }
      iter.next();
    }
    expect(hasHidden).toBe(true);
  });
});
```

Wait — this test is complex because we need a real EditorView in jsdom. Let me simplify: test the pure decoration-building logic by extracting a `buildDecorations(state: EditorState): DecorationSet` function and testing it directly without a live view.

Rewrite the test (simpler, pure-function approach):

```ts
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { buildDecorations } from "../livePreview";

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdown()] });
}

describe("buildDecorations", () => {
  it("hides bold emphasis markers (**)", () => {
    const state = stateOf("**bold** text");
    const decos = buildDecorations(state);
    // The opening ** (positions 0-2) and closing ** (positions 6-8) should
    // each have a decoration with the hidden-marker class
    const hidden = decos.update({ filter: (_from, _to, val) => {
      return val.spec?.attributes?.class?.includes?.("cm-hidden-marker") ?? false;
    }});
    expect(hidden.size).toBe(2); // two marker ranges (opening + closing)
  });

  it("hides inline code backticks", () => {
    const state = stateOf("`code` text");
    const decos = buildDecorations(state);
    expect(decos.size).toBeGreaterThanOrEqual(1);
    const iter = decos.iter();
    let found = false;
    while (iter.value) {
      const cls = iter.value.spec?.attributes?.class || "";
      if (cls.includes("cm-hidden-marker") && cls.includes("cm-code-marker")) {
        found = true;
      }
      iter.next();
    }
    expect(found).toBe(true);
  });

  it("does NOT hide markers inside code blocks", () => {
    const state = stateOf('```\n**not bold in code**\n```\n');
    const decos = buildDecorations(state);
    // No decorations should be inside a code block
    expect(decos.size).toBe(0);
  });

  it("renders inline code with monospace class", () => {
    const state = stateOf("`code`");
    const decos = buildDecorations(state);
    const iter = decos.iter();
    let foundCode = false;
    while (iter.value) {
      const cls = iter.value.spec?.attributes?.class || "";
      if (cls.includes("cm-inline-code")) {
        foundCode = true;
      }
      iter.next();
    }
    expect(foundCode).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/editor/__tests__/livePreview.test.ts
```

Expected: FAIL — `Cannot find module '../livePreview'`.

- [ ] **Step 3: Implement livePreview.ts**

Create `src/editor/livePreview.ts`:

```ts
import { EditorState } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

const HIDDEN_MARKER_CLASS = "cm-hidden-marker";
const INLINE_CODE_CLASS = "cm-inline-code";

/** Pure function: build decorations for the entire doc from the Lezer syntax tree. */
export function buildDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(state);

  // Process the full tree; for a real viewport-scoped implementation we'd
  // filter by visibleRanges. The pure function covers the whole doc.
  tree.iterate({
    enter(node) {
      const nodeType = node.type.name;

      // --- Inline: StrongEmphasis / Emphasis ---
      if (nodeType === "StrongEmphasis" || nodeType === "Emphasis") {
        // Hide the markers (*, **, __), style the content
        for (const child of getChildren(node, tree)) {
          const childType = child.type.name;
          if (childType === "EmphasisMark") {
            builder.add(
              child.from, child.to,
              Decoration.mark({
                attributes: { class: `${HIDDEN_MARKER_CLASS} cm-emphasis-marker`, style: "opacity: 0.3" },
              }),
            );
          }
        }
        return false; // don't recurse into children again
      }

      // --- Inline: InlineCode ---
      if (nodeType === "InlineCode") {
        for (const child of getChildren(node, tree)) {
          const childType = child.type.name;
          if (childType === "CodeMark") {
            builder.add(
              child.from, child.to,
              Decoration.mark({
                attributes: { class: `${HIDDEN_MARKER_CLASS} cm-code-marker`, style: "opacity: 0.3" },
              }),
            );
          }
        }
        // Style the entire InlineCode range with monospace
        builder.add(
          node.from, node.to,
          Decoration.mark({
            attributes: { class: INLINE_CODE_CLASS },
          }),
        );
        return false;
      }

      // --- Inline: Link ---
      if (nodeType === "Link") {
        // Hide the brackets and mark, style the text as a link
        let linkText: SyntaxNode | null = null;
        let urlNode: SyntaxNode | null = null;
        for (const child of getChildren(node, tree)) {
          if (child.type.name === "LinkText") linkText = child;
          if (child.type.name === "URL") urlNode = child;
          if (child.type.name === "LinkMark") {
            builder.add(
              child.from, child.to,
              Decoration.mark({
                attributes: { class: `${HIDDEN_MARKER_CLASS} cm-link-marker`, style: "opacity: 0.3" },
              }),
            );
          }
        }
        if (linkText) {
          builder.add(
            linkText.from, linkText.to,
            Decoration.mark({
              attributes: { class: "cm-link", style: "color: #0366d6; text-decoration: underline" },
            }),
          );
        }
        return false;
      }

      // Block nodes (Task, CodeBlock, Table) are handled in Tasks 5-6.
      // For now, just skip deep recursion into code blocks to avoid false positives.
      if (nodeType === "FencedCode" || nodeType === "CodeBlock") {
        return false;
      }
    },
  });

  return builder.finish();
}

/** Helper: iterate over direct children of a SyntaxNode */
function getChildren(node: SyntaxNode, tree: ReturnType<typeof syntaxTree>): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  const cursor = node.cursor();
  if (cursor.firstChild()) {
    do {
      result.push(cursor.node);
    } while (cursor.nextSibling());
  }
  return result;
}

/** ViewPlugin class wrapping buildDecorations with viewport awareness */
export class LivePreviewPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view.state);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildDecorations(update.view);
    }
  }
}

export const livePreviewExtension = ViewPlugin.fromClass(LivePreviewPlugin, {
  decorations: (v) => v.decorations,
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/editor/__tests__/livePreview.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/editor/livePreview.ts src/editor/__tests__/livePreview.test.ts
git commit -m "feat(editor): live preview ViewPlugin with inline decorations"
```

---

## Task 5: Block widgets — CodeBlock, Table, TaskCheckbox (TDD)

**Files:**
- Create: `src/editor/widgets.ts`
- Create: `src/editor/__tests__/widgets.test.ts`

- [ ] **Step 1: Write failing widget tests**

Create `src/editor/__tests__/widgets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TaskCheckboxWidget } from "../widgets";
import type { EditorView } from "@codemirror/view";

function mockView(): EditorView {
  return { dispatch: () => {} } as unknown as EditorView;
}

describe("TaskCheckboxWidget", () => {
  it("renders unchecked for [ ]", () => {
    const widget = new TaskCheckboxWidget(false);
    const dom = widget.toDOM(mockView());
    const input = dom.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.checked).toBe(false);
    expect(input.disabled).toBe(false);
  });

  it("renders checked for [x]", () => {
    const widget = new TaskCheckboxWidget(true);
    const dom = widget.toDOM(mockView());
    const input = dom.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(input.checked).toBe(true);
  });

  it("eq returns true for same checked state", () => {
    expect(new TaskCheckboxWidget(true).eq(new TaskCheckboxWidget(true))).toBe(true);
  });

  it("eq returns false for different checked state", () => {
    expect(new TaskCheckboxWidget(true).eq(new TaskCheckboxWidget(false))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/editor/__tests__/widgets.test.ts
```

Expected: FAIL — `Cannot find module '../widgets'`.

- [ ] **Step 3: Implement widgets.ts**

Create `src/editor/widgets.ts`:

```ts
import { WidgetType } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { renderMarkdown } from "./markdown";

/** Widget that renders a fenced code block with syntax highlighting */
export class CodeBlockWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly lang: string,
  ) {
    super();
  }

  eq(other: CodeBlockWidget): boolean {
    return other.code === this.code && other.lang === this.lang;
  }

  toDOM(view: EditorView): HTMLElement {
    const pre = document.createElement("pre");
    pre.className = "cm-code-block";

    if (this.lang) {
      const langLabel = document.createElement("span");
      langLabel.className = "cm-code-lang";
      langLabel.textContent = this.lang;
      pre.appendChild(langLabel);
    }

    const codeEl = document.createElement("code");
    if (this.lang) {
      codeEl.className = `language-${this.lang}`;
    }
    // Render via markdown-it (which uses lowlight for highlighting)
    const html = renderMarkdown("```" + (this.lang || "") + "\n" + this.code + "\n```");
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const highlighted = tmp.querySelector("code")!;
    codeEl.innerHTML = highlighted?.innerHTML || this.code;
    pre.appendChild(codeEl);
    return pre;
  }
}

/** Widget that renders a GFM table */
export class TableWidget extends WidgetType {
  constructor(readonly markdown: string) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.markdown === this.markdown;
  }

  toDOM(_view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-table-wrapper";
    wrapper.innerHTML = renderMarkdown(this.markdown);
    return wrapper;
  }
}

/** Widget that renders a clickable task checkbox */
export class TaskCheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked;
  }

  toDOM(view: EditorView): HTMLElement {
    const label = document.createElement("label");
    label.className = "cm-task-checkbox";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.addEventListener("click", (e) => {
      e.preventDefault();
      // The rewrite is handled by the plugin that replaces the [ ] / [x] text.
      // Here we just signal it was clicked; the plugin in livePreview.ts
      // reads the widget's position and dispatches a transaction.
      input.checked = !this.checked;
      label.dispatchEvent(new CustomEvent("cm-task-toggle", {
        bubbles: true,
        detail: { from: -1, to: -1 }, // filled by the container plugin
      }));
    });
    label.appendChild(input);
    return label;
  }

  /** Ignore mouse events on the checkbox — let the widget handle clicks */
  ignoreEvent(_event: Event): boolean {
    return _event.type === "mousedown" || _event.type === "mouseup" || _event.type === "click";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/editor/__tests__/widgets.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/editor/widgets.ts src/editor/__tests__/widgets.test.ts
git commit -m "feat(editor): block widgets (CodeBlock, Table, TaskCheckbox)"
```

---

## Task 6: Extend live preview with block decorations and task toggle (TDD)

**Files:**
- Modify: `src/editor/livePreview.ts`
- Modify: `src/editor/__tests__/livePreview.test.ts`

- [ ] **Step 1: Add failing block decoration tests**

Append to `src/editor/__tests__/livePreview.test.ts`:

```ts
  it("replaces a task-list line with a checkbox widget", () => {
    const state = stateOf("- [ ] buy milk\n");
    const decos = buildDecorations(state);
    // There should be a Decoration.replace widget at the [ ] marker position
    const iter = decos.iter();
    let foundWidget = false;
    while (iter.value) {
      if (iter.value.spec?.widget) {
        foundWidget = true;
      }
      iter.next();
    }
    expect(foundWidget).toBe(true);
  });

  it("replaces a fenced code block with a CodeBlockWidget", () => {
    const state = stateOf("```js\nlet x = 1;\n```\n");
    const decos = buildDecorations(state);
    const iter = decos.iter();
    let foundCodeWidget = false;
    while (iter.value) {
      if (iter.value.spec?.widget) {
        const w = iter.value.spec.widget;
        if (w && typeof w === "object") {
          foundCodeWidget = true;
        }
      }
      iter.next();
    }
    expect(foundCodeWidget).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/editor/__tests__/livePreview.test.ts
```

Expected: FAIL — block decoration tests fail (no widgets produced for blocks).

- [ ] **Step 3: Add block decoration logic to buildDecorations**

Modify `src/editor/livePreview.ts`. In `buildDecorations`, add to the `tree.iterate({ enter(node) { ... } })` block, inside the `enter` callback, before the inline handling:

```ts
      // --- Block: Task / TaskMarker ---
      if (nodeType === "TaskMarker") {
        const text = state.doc.sliceString(node.from, node.to);
        const checked = text === "[x]" || text === "[X]";
        builder.add(
          node.from, node.to,
          Decoration.replace({ widget: new TaskCheckboxWidget(checked) }),
        );
        return false;
      }

      // --- Block: FencedCode / CodeBlock ---
      if (nodeType === "FencedCode" || nodeType === "CodeBlock") {
        let lang = "";
        let codeText = "";
        for (const child of getChildren(node, tree)) {
          if (child.type.name === "CodeText") {
            codeText = state.doc.sliceString(child.from, child.to);
          }
          if (child.type.name === "CodeInfo") {
            lang = state.doc.sliceString(child.from, child.to);
          }
        }
        builder.add(
          node.from, node.to,
          Decoration.replace({ widget: new CodeBlockWidget(codeText, lang) }),
        );
        return false;
      }

      // --- Block: Table (GFM) ---
      if (nodeType === "Table") {
        const tableSrc = state.doc.sliceString(node.from, node.to);
        builder.add(
          node.from, node.to,
          Decoration.replace({ widget: new TableWidget(tableSrc) }),
        );
        return false;
      }
```

Also add the import for `TaskCheckboxWidget`, `CodeBlockWidget`, `TableWidget` from `./widgets`.

- [ ] **Step 4: Implement task toggle (checkbox click -> rewrite source)**

Add to `src/editor/livePreview.ts`, in the `LivePreviewPlugin` class, an `eventHandlers` static method or a DOM event listener pattern. The cleanest approach: make `LivePreviewPlugin` handle DOM events:

```ts
  // Inside LivePreviewPlugin class, add:
  handleTaskToggle(event: Event) {
    const customEvt = event as CustomEvent;
    if (customEvt.type === "cm-task-toggle" && customEvt.detail) {
      // We can't dispatch transactions from a static handler easily.
      // Instead, capture clicks in the plugin's domEventHandlers.
    }
  }
```

Better: use CM6's `domEventHandlers`:

Add to the `ViewPlugin.fromClass` static:

```ts
export const livePreviewExtension = ViewPlugin.fromClass(LivePreviewPlugin, {
  decorations: (v) => v.decorations,
  eventHandlers: {
    click(e, view) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" && target.closest(".cm-task-checkbox")) {
        const pos = view.posAtDOM(target);
        // Find the [ ] or [x] marker near this position
        const tree = syntaxTree(view.state);
        const node = tree.resolve(pos, -1);
        if (node && node.type.name === "TaskMarker") {
          const text = view.state.doc.sliceString(node.from, node.to);
          const newText = text === "[ ]" ? "[x]" : "[ ]";
          view.dispatch({
            changes: { from: node.from, to: node.to, insert: newText },
          });
          return true; // handled
        }
      }
      return false;
    },
  },
});
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/editor/__tests__/livePreview.test.ts
```

Expected: 6 tests PASS (4 inline from Task 4 + 2 block from this task).

- [ ] **Step 6: Commit**

```bash
git add src/editor/livePreview.ts src/editor/__tests__/livePreview.test.ts
git commit -m "feat(editor): block decorations (code table task) + toggle checkbox"
```

---

## Task 7: React EditorView wrapper

**Files:**
- Create: `src/editor/EditorView.tsx`

- [ ] **Step 1: Write the React wrapper**

Create `src/editor/EditorView.tsx`:

```tsx
import React, { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { EditorView } from "@codemirror/view";
import { createEditorState } from "./codemirror";

export interface EditorHandle {
  getDoc(): string;
  setDoc(doc: string): void;
}

interface EditorViewProps {
  doc: string;
  onChange?: (doc: string) => void;
}

export const MarkdownEditor = forwardRef<EditorHandle, EditorViewProps>(
  function MarkdownEditor({ doc, onChange }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    useEffect(() => {
      if (!containerRef.current) return;
      const state = createEditorState(doc, (newDoc) => {
        onChange?.(newDoc);
      });
      const view = new EditorView({
        state,
        parent: containerRef.current,
      });
      viewRef.current = view;
      return () => view.destroy();
    }, []); // mount once; doc updates come via setDoc imperatively

    // Expose imperative handle for Plan 3's tab switching
    useImperativeHandle(ref, () => ({
      getDoc: () => viewRef.current?.state.doc.toString() ?? "",
      setDoc: (newDoc: string) => {
        if (!viewRef.current) return;
        const view = viewRef.current;
        view.dispatch({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: newDoc,
          },
        });
      },
    }));

    return <div ref={containerRef} className="markdown-editor" />;
  },
);
```

This is a skeleton — the `createEditorState` must include the `livePreviewExtension` in the extensions array (done in Task 8).

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/editor/EditorView.tsx
git commit -m "feat(editor): React MarkdownEditor wrapper with imperative handle"
```

---

## Task 8: Wire live preview into the CM6 factory + integration smoke

**Files:**
- Modify: `src/editor/codemirror.ts`

- [ ] **Step 1: Include live preview extension in createEditorState**

Edit `src/editor/codemirror.ts` — add the `livePreviewExtension` to the extensions array:

```ts
import { livePreviewExtension } from "./livePreview";

// Inside createEditorState, extensions array:
    extensions: [
      lineNumbers(),
      markdown(),
      keymap.of(defaultKeymap),
      updateListener,
      themeCompartment.of(EditorView.theme({})),
      livePreviewExtension,  // <-- added
    ],
```

- [ ] **Step 2: Verify compilation**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run full editor test suite**

```bash
npx vitest run src/editor/__tests__/
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/editor/codemirror.ts
git commit -m "feat(editor): wire live preview into editor factory"
```

---

## Done criteria

- `markdown-it` renders GFM tables, task lists, strikethrough, fenced code with highlights.
- `buildDecorations` produces `Decoration.mark` hiding bold/italic/code/link syntax markers.
- `buildDecorations` produces `Decoration.replace` widgets for tables, code blocks, task items.
- Clicking a task checkbox toggles `[ ]` ↔ `[x]` in the source.
- `MarkdownEditor` React component mounts CM6 and exposes `getDoc()`/`setDoc()`.
- All tests pass (`npx vitest run src/editor/__tests__/`).

## What this plan does NOT cover (deferred to Plan 3)

- 3-pane layout, file tree, tabs, outline (UI shell)
- Image paste/drop interception and storage
- Zustand stores and IPC wiring
- Auto-save, external-change handling, conflict prompts
- Theme toggle UI, settings panel
- `Ctrl+P` quick-open
