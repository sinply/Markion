import type { EditorView } from "@codemirror/view";

/** The currently-mounted editor view, so menu commands can dispatch to it. */
let currentView: EditorView | null = null;

export function setEditorView(v: EditorView | null) {
  currentView = v;
}

export function getEditorView(): EditorView | null {
  return currentView;
}
