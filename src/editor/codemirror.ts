import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Table, TaskList, Strikethrough } from "@lezer/markdown";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, foldGutter, foldKeymap } from "@codemirror/language";
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { livePreviewExtension, livePreviewField, previewField } from "./livePreview";
import { markdownContextFacet, imagePasteDropExtension, type MarkdownContext } from "./media";
import { wikilinkCompletion } from "./wikilink";

const themeCompartment = new Compartment();
const livePreviewCompartment = new Compartment();

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
  },
): EditorState {
  const livePreview = opts?.livePreview ?? true;
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      onChange(update.state.doc.toString());
    }
    opts?.onStateChange?.(update.state);
  });

  return EditorState.create({
    doc,
    extensions: [
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
      themeCompartment.of(EditorView.theme({})),
      opts?.markdownContext ? markdownContextFacet.of(opts.markdownContext) : [],
      imagePasteDropExtension,
      wikilinkCompletion,
      livePreviewCompartment.of(livePreview ? [livePreviewField, livePreviewExtension] : []),
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

export { themeCompartment, livePreviewCompartment };
