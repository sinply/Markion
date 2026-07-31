import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { livePreviewExtension, livePreviewField } from "./livePreview";

const themeCompartment = new Compartment();

export function createEditorState(doc: string, onChange: (doc: string) => void): EditorState {
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      onChange(update.state.doc.toString());
    }
  });

  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      markdown({ base: markdownLanguage }),
      keymap.of(defaultKeymap),
      history(),
      keymap.of(historyKeymap),
      syntaxHighlighting(defaultHighlightStyle),
      updateListener,
      themeCompartment.of(EditorView.theme({})),
      livePreviewField,
      livePreviewExtension,
    ],
  });
}

export { themeCompartment };
