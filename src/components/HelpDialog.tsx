import { useUiStore } from "../stores/uiStore";

const HELP_SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "Getting started",
    body: [
      "Markion works on a vault: a folder of plain .md files. Click File → Open Folder… (or Ctrl+Shift+O) to choose one.",
      "The left sidebar shows your document tree; the middle is the editor; the right sidebar has the outline, backlinks, and graph.",
    ],
  },
  {
    title: "Editing",
    body: [
      "Markion has two view modes (View menu or Ctrl+E): Edit (live preview as you type) and Preview (full rendered document).",
      "Select text and use Edit → Format (or Ctrl+B, Ctrl+I, Ctrl+1..3) to apply bold, italic, headings, lists, links, and more.",
      "Type - [ ] to create a task item; click the checkbox to toggle it. Tables, code blocks, images, and math render live.",
    ],
  },
  {
    title: "Markdown supported",
    body: [
      "Headings (# .. ######), bold/italic/strikethrough, inline code, fenced code blocks with syntax highlighting.",
      "GFM tables, task lists, blockquotes, ordered/bullet lists, links, images, horizontal rules.",
      "$$...$$ block math and $...$ inline math (KaTeX). ```mermaid code blocks render as diagrams.",
      "YAML frontmatter at the top of a note (---...---) renders as a Properties panel.",
    ],
  },
  {
    title: "Document tree & links",
    body: [
      "Drag files to reorder (within a folder) or move (across folders). A folder containing index.md opens it when you click the folder name.",
      "Link notes with [[note-name]]. The backlinks panel shows what links to the current note; the graph view maps all connections.",
    ],
  },
  {
    title: "Settings",
    body: [
      "File → Preferences opens settings: assets directory strategy, image path style, live-preview toggle, and theme.",
      "8 themes are available (View → Theme): System, Light, Dark, Sepia, Eye-care, Nord, Dracula, Solarized.",
      "Settings persist to .markion/config.json inside your vault.",
    ],
  },
  {
    title: "Shortcuts",
    body: [
      "Ctrl+O open file · Ctrl+Shift+O open folder · Ctrl+S save · Ctrl+Shift+S save as.",
      "Ctrl+E toggle edit/preview · Ctrl+Z/Y undo/redo · Ctrl+B/I bold/italic · Ctrl+1..3 headings.",
      "Ctrl+Shift+P (planned) command palette.",
    ],
  },
];

export function HelpDialog() {
  const open = useUiStore((s) => s.helpOpen);
  const setOpen = useUiStore((s) => s.setHelpOpen);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", top: "6%", left: "20%", width: "60%", maxHeight: "84%",
        background: "var(--bg)", boxShadow: "0 6px 30px rgba(0,0,0,0.3)", borderRadius: 10,
        zIndex: 3000, padding: 20, fontSize: 14, display: "flex", flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0, flex: 1 }}>Markion — Documentation</h2>
        <button
          onClick={() => setOpen(false)}
          style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 18, color: "var(--fg-muted)" }}
        >
          ×
        </button>
      </div>
      <div style={{ overflow: "auto", flex: 1 }}>
        {HELP_SECTIONS.map((s) => (
          <div key={s.title} style={{ marginBottom: 14 }}>
            <h3 style={{ margin: "0 0 4px 0", fontSize: 15 }}>{s.title}</h3>
            {s.body.map((p, i) => (
              <p key={i} style={{ margin: "0 0 6px 0", lineHeight: 1.6, color: "var(--fg)" }}>
                {p}
              </p>
            ))}
          </div>
        ))}
      </div>
      <button onClick={() => setOpen(false)} style={{ padding: "6px 16px", marginTop: 12, cursor: "pointer" }}>
        Close
      </button>
    </div>
  );
}
