import { describe, it, expect } from "vitest";
import { buildCommands } from "../../lib/commands";
import { filterPalette } from "../CommandPalette";
import { useSettingsStore } from "../../stores/settingsStore";

// Use the English dictionary for deterministic labels.
useSettingsStore.setState({ language: "en" });

const enT = enDictStub() as Parameters<typeof buildCommands>[0];
const files = [
  { name: "design.md", path: "design.md" },
  { name: "api.md", path: "notes/api.md" },
];

describe("buildCommands", () => {
  it("covers formatting, edit, file, and view commands", () => {
    const cmds = buildCommands(enT);
    const ids = new Set(cmds.map((c) => c.id));
    expect(ids.has("md:bold")).toBe(true);
    expect(ids.has("md:heading1")).toBe(true);
    expect(ids.has("edit:undo")).toBe(true);
    expect(ids.has("file:openFolder")).toBe(true);
    expect(ids.has("file:saveAs")).toBe(true);
    expect(ids.has("theme:dark")).toBe(true);
    expect(ids.has("lang:zh")).toBe(true);
  });
});

describe("filterPalette", () => {
  const commands = buildCommands(enT);

  it("matches files by name", () => {
    const items = filterPalette(files, commands, "api");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "file", name: "api.md", path: "notes/api.md" });
  });

  it("matches commands by title and keywords", () => {
    const items = filterPalette(files, commands, "undo");
    expect(items.some((i) => i.kind === "command" && i.cmd.id === "edit:undo")).toBe(true);
    const themeItems = filterPalette(files, commands, "dracula");
    expect(themeItems.some((i) => i.kind === "command" && i.cmd.id === "theme:dracula")).toBe(true);
  });

  it("lists files before commands on an empty query", () => {
    const items = filterPalette(files, commands, "");
    expect(items.filter((i) => i.kind === "file")).toHaveLength(2);
    expect(items.some((i) => i.kind === "command")).toBe(true);
  });

  it("offers a create entry when nothing matches", () => {
    const items = filterPalette(files, commands, "zzznone");
    expect(items).toEqual([{ kind: "create", name: "zzznone" }]);
  });

  it("does not offer create when a command matches", () => {
    const items = filterPalette([], commands, "save");
    expect(items.some((i) => i.kind === "create")).toBe(false);
  });
});

/** Minimal English dict stub — enough for buildCommands to construct labels. */
function enDictStub() {
  return {
    bold: "Bold", italic: "Italic", strikethrough: "Strikethrough", inlineCode: "Inline Code",
    heading1: "Heading 1", heading2: "Heading 2", heading3: "Heading 3", codeBlock: "Code Block",
    table: "Table", blockquote: "Blockquote", bulletList: "Bullet List", numberedList: "Numbered List",
    taskList: "Task List", link: "Link", image: "Image",
    toc: "Insert Table of Contents", tableFormat: "Format Table",
    undo: "Undo", redo: "Redo", cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select All",
    openFolder: "Open Folder…", openFile: "Open File…", save: "Save", saveAs: "Save As…",
    exportHtml: "Export as HTML…", exportMarkdown: "Export as Markdown…", exportPdf: "Export as PDF…",
    exportImage: "Export as Image (PNG)…",
    newDailyNote: "Open Today's Note", insertTemplate: "Insert Template…",
    editProperties: "Edit Properties…",
    reopenClosed: "Reopen Closed Tab", fullscreen: "Toggle Fullscreen",
    editMode: "Edit Mode", previewMode: "Preview Mode", preferences: "Preferences…",
    focusMode: "Focus Mode",
    baseOpenCommand: "Open Database…",
    slideshowCommand: "Start Slideshow",
    theme: "Theme", language: "Language",
    find: "Find…", findShortcut: "Ctrl+F",
    findInVault: "Find in Vault…", findInVaultShortcut: "Ctrl+Shift+F",
  };
}
