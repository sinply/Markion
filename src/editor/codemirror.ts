import { EditorState, Compartment, StateEffect, StateField, Facet } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  ViewPlugin,
  Decoration,
  drawSelection,
  type DecorationSet,
} from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Table, TaskList, Strikethrough } from "@lezer/markdown";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, foldGutter, foldKeymap } from "@codemirror/language";
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { livePreviewExtension, livePreviewField, previewField } from "./livePreview";
import { markdownContextFacet, imagePasteDropExtension, type MarkdownContext } from "./media";
import { wikilinkCompletionSource } from "./wikilink";
import { slashCompletionSource } from "./slash";
import { autocompletion } from "@codemirror/autocomplete";

const themeCompartment = new Compartment();
const livePreviewCompartment = new Compartment();

/** Single autocompletion extension hosting both sources. Two separate
 *  `autocompletion()` extensions would each carry a config facet that CM6
 *  cannot merge ("Config merge conflict for field override"). */
const editorCompletion = autocompletion({
  override: [wikilinkCompletionSource, slashCompletionSource],
  activateOnTyping: true,
});
const focusCompartment = new Compartment();

/** Theme for the built-in find/replace panel and match highlights, so they
 *  follow the app's CSS variables instead of CodeMirror's defaults. */
const searchTheme = EditorView.theme({
  "&": { "--search-highlight": "rgba(255, 213, 89, 0.45)" },
  ".cm-panel.cm-search": {
    padding: "6px 8px",
    borderBottom: "1px solid var(--border)",
    background: "var(--panel-bg)",
    color: "var(--fg)",
    fontSize: 13,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px",
  },
  ".cm-panel.cm-search label": {
    display: "flex",
    alignItems: "center",
    gap: 4,
    margin: 0,
    fontSize: 12,
  },
  ".cm-panel.cm-search input": {
    background: "var(--bg)",
    color: "var(--fg)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "2px 6px",
    fontSize: 13,
    outline: "none",
  },
  ".cm-panel.cm-search input:focus": { borderColor: "var(--accent)" },
  ".cm-panel.cm-search button": {
    background: "var(--bg)",
    color: "var(--fg)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 12,
    cursor: "pointer",
  },
  ".cm-panel.cm-search button:hover": { borderColor: "var(--accent)" },
  ".cm-panel.cm-search [name=close]": {
    position: "static",
    marginLeft: "auto",
  },
  ".cm-searchMatch": {
    background: "var(--search-highlight)",
    outline: "1px solid rgba(255, 165, 0, 0.5)",
    borderRadius: 2,
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    background: "rgba(88, 166, 255, 0.6)",
  },
  ".cm-selectionMatch": {
    background: "var(--search-highlight)",
  },
});

/** Fold gutter styling that follows the app theme instead of CM6 defaults. */
const foldTheme = EditorView.theme({
  ".cm-foldGutter": { color: "var(--fg-muted)" },
  ".cm-foldGutterElement": {
    cursor: "pointer",
    fontSize: 12,
    lineHeight: "18px",
  },
});

export type EditorMode = "live" | "preview";

export function createEditorState(
  doc: string,
  onChange: (doc: string) => void,
  opts?: {
    livePreview?: boolean;
    onStateChange?: (state: EditorState) => void;
    markdownContext?: MarkdownContext;
    /** Called on right-click inside the editor (custom context menu). */
    onEditorContextMenu?: (x: number, y: number, view: EditorView) => void;
  },
): EditorState {
  const livePreview = opts?.livePreview ?? true;
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      onChange(update.state.doc.toString());
    }
    opts?.onStateChange?.(update.state);
  });

  const contextMenuHandler = opts?.onEditorContextMenu
    ? EditorView.domEventHandlers({
        contextmenu(event, view) {
          event.preventDefault();
          opts.onEditorContextMenu!(event.clientX, event.clientY, view);
          return true;
        },
      })
    : [];

  return EditorState.create({
    doc,
    extensions: [
      // Multiple cursors / column selection (Alt+click adds a cursor,
      // Shift+Alt+drag selects a column). Draws every selection ourselves
      // because the browser can only paint one native selection at a time.
      EditorState.allowMultipleSelections.of(true),
      drawSelection(),
      // Soft-wrap long lines instead of a horizontal scrollbar at the bottom.
      EditorView.lineWrapping,
      lineNumbers(),
      foldGutter(),
      markdown({ base: markdownLanguage, extensions: [Table, TaskList, Strikethrough] }),
      keymap.of(defaultKeymap),
      keymap.of(foldKeymap),
      history(),
      keymap.of(historyKeymap),
      syntaxHighlighting(defaultHighlightStyle),
      search({ top: true }),
      keymap.of(searchKeymap),
      highlightSelectionMatches(),
      searchTheme,
      foldTheme,
      updateListener,
      contextMenuHandler,
      themeCompartment.of(EditorView.theme({})),
      opts?.markdownContext ? markdownContextFacet.of(opts.markdownContext) : [],
      imagePasteDropExtension,
      editorCompletion,
      livePreviewCompartment.of(livePreview ? [livePreviewField, livePreviewExtension] : []),
      focusField,
      focusLineHighlighter,
      typewriterPlugin,
    ],
  });
}

/** Set the editor mode on an existing view. "live" = live preview (default),
 *  "preview" = full read-only rendered document. */
export function setEditorMode(view: EditorView, mode: EditorMode): void {
  const ext =
    mode === "preview"
      ? [previewField, EditorState.readOnly.of(true)]
      : [livePreviewField, livePreviewExtension, EditorState.readOnly.of(false)];
  view.dispatch({
    effects: livePreviewCompartment.reconfigure(ext),
  });
}

/** Toggle live preview decorations (the settings toggle): off = raw source. */
export function setLivePreview(view: EditorView, enabled: boolean): void {
  view.dispatch({
    effects: livePreviewCompartment.reconfigure(enabled ? [livePreviewField, livePreviewExtension] : []),
  });
}

/** Focus mode (Typora-style active-line highlight + typewriter centering).
 *
 *  Implemented with a StateField + StateEffect instead of a Compartment:
 *  reconfiguring any compartment on a state built by createEditorState throws
 *  "Config merge conflict for field override" (the editor registers several
 *  config-carrying extensions statically; CM6 can't merge a swapped config on
 *  top of them in this app's extension set). Effects only re-run plugins,
 *  which keeps the change instant and preserves undo history. */

/** Facet: whether focus mode is on. */
const focusModeFacet = Facet.define<boolean, boolean>({ combine: (v) => v[0] ?? false });

/** Toggle effect consumed by the focus state field. */
export const focusEffect = StateEffect.define<boolean>();

const focusField = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => {
    for (const e of tr.effects) {
      if (e.is(focusEffect)) return e.value;
    }
    return value;
  },
  provide: (f) => focusModeFacet.from(f),
});

/** Active-line highlight: a line decoration shown only while focus mode is on. */
const focusLineHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    constructor(view: EditorView) {
      this.decorations = this.compute(view);
    }
    update(u: {
      docChanged: boolean;
      selectionSet: boolean;
      view: EditorView;
      startState: EditorState;
    }) {
      const focusChanged =
        u.startState.facet(focusModeFacet) !== u.view.state.facet(focusModeFacet);
      if (u.docChanged || u.selectionSet || focusChanged) {
        this.decorations = this.compute(u.view);
      }
    }
    compute(view: EditorView): DecorationSet {
      if (!view.state.facet(focusModeFacet)) return Decoration.none;
      const { from } = view.state.selection.main;
      const line = view.state.doc.lineAt(from);
      return Decoration.set([Decoration.line({ class: "cm-activeLine" }).range(line.from)]);
    }
  },
  { decorations: (v) => v.decorations },
);

/** Typewriter scrolling: keep the active line near the vertical center while
 *  focus mode is on. Measuring must wait until after the update flush. */
const typewriterPlugin = ViewPlugin.fromClass(
  class {
    update(u: { selectionSet: boolean; docChanged: boolean; view: EditorView }) {
      if (!u.selectionSet || u.docChanged) return;
      const view = u.view;
      if (!view.state.facet(focusModeFacet)) return;
      window.setTimeout(() => {
        try {
          const { from } = view.state.selection.main;
          const line = view.state.doc.lineAt(from);
          const coords = view.coordsAtPos(line.from);
          const scroller = view.scrollDOM;
          if (!coords || scroller.clientHeight === 0) return;
          scroller.scrollTo({
            top: scroller.scrollTop + coords.top - scroller.clientHeight / 2,
            behavior: "smooth",
          });
        } catch {
          // Non-browser environments (jsdom) can't measure text rects — ignore.
        }
      }, 0);
    }
  },
);

/** Toggle focus mode without rebuilding the editor config. */
export function setFocusMode(view: EditorView, enabled: boolean): void {
  view.dispatch({ effects: focusEffect.of(enabled) });
}

export { themeCompartment, livePreviewCompartment };
