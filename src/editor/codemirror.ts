import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Table, TaskList, Strikethrough } from "@lezer/markdown";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { livePreviewExtension, livePreviewField } from "./livePreview";
import { markdownContextFacet, imagePasteDropExtension, type MarkdownContext } from "./media";

const themeCompartment = new Compartment();
const livePreviewCompartment = new Compartment();

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
      markdown({ base: markdownLanguage, extensions: [Table, TaskList, Strikethrough] }),
      keymap.of(defaultKeymap),
      history(),
      keymap.of(historyKeymap),
      syntaxHighlighting(defaultHighlightStyle),
      updateListener,
      themeCompartment.of(EditorView.theme({})),
      opts?.markdownContext ? markdownContextFacet.of(opts.markdownContext) : [],
      imagePasteDropExtension,
      livePreviewCompartment.of(livePreview ? [livePreviewField, livePreviewExtension] : []),
    ],
  });
}

/** Toggle live preview on an existing EditorView by reconfiguring its compartment. */
export function setLivePreview(view: EditorView, enabled: boolean): void {
  view.dispatch({
    effects: livePreviewCompartment.reconfigure(enabled ? [livePreviewField, livePreviewExtension] : []),
  });
}

export { themeCompartment, livePreviewCompartment };
