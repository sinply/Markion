import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
  type Completion,
} from "@codemirror/autocomplete";

interface SlashCommand {
  label: string;
  detail?: string;
  /** Text inserted at the cursor (or a function returning it, e.g. dates). */
  insert: string | (() => string);
  /** Cursor offset relative to the inserted text (default: end). */
  cursor?: number;
}

/** Obsidian-style slash commands: type `/` + a few letters to insert markdown
 *  building blocks. Kept to the most useful ones. */
const SLASH_COMMANDS: SlashCommand[] = [
  { label: "Heading 1", insert: "# ", cursor: 2 },
  { label: "Heading 2", insert: "## ", cursor: 3 },
  { label: "Heading 3", insert: "### ", cursor: 4 },
  { label: "Bold", insert: "****", cursor: 2 },
  { label: "Italic", insert: "**", cursor: 1 },
  { label: "Strikethrough", insert: "~~~~", cursor: 2 },
  { label: "Inline Code", insert: "``", cursor: 1 },
  { label: "Code Block", detail: "```", insert: "```\n\n```", cursor: 4 },
  { label: "Quote", insert: "> ", cursor: 2 },
  { label: "Bullet List", insert: "- ", cursor: 2 },
  { label: "Numbered List", insert: "1. ", cursor: 3 },
  { label: "Task List", insert: "- [ ] ", cursor: 6 },
  { label: "Link", insert: "[text](url)", cursor: 1 },
  { label: "Image", insert: "![alt](url)", cursor: 2 },
  {
    label: "Table",
    insert: "| a | b |\n| - | - |\n|  |  |",
    // Insert text is 27 chars; land INSIDE the first header cell of row 1
    // (offset 2 = after "| "). 28 used to point one char PAST the end.
    cursor: 2,
  },
  { label: "Callout", insert: "> [!note]\n> ", cursor: 9 },
  { label: "Horizontal Rule", insert: "---\n\n", cursor: 4 },
  { label: "Mermaid", insert: "```mermaid\n\ngraph TD;\n```", cursor: 13 },
  { label: "Today's Date", insert: () => {
      const d = new Date();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${d.getFullYear()}-${m}-${day}`;
    }, cursor: 0 },
];

function insertText(cmd: SlashCommand): string {
  return typeof cmd.insert === "function" ? cmd.insert() : cmd.insert;
}

/** Match `/word` immediately before the cursor, but only when the slash starts
 *  a fresh token (line start or after whitespace) — never inside URLs. */
const slashMatch = /(?:^|\s)\/([a-zA-Z\u4e00-\u9fff]*)$/;

export function slashCompletionSource(context: CompletionContext): CompletionResult | null {
  const before = context.state.sliceDoc(0, context.pos);
  const match = before.match(slashMatch);
  if (!match) return null;
  const slashIdx = before.lastIndexOf("/");
  // Skip `://` (http://, file://) and Windows drive paths (C:/).
  if (/[:\w]\:\//.test(before.slice(Math.max(0, slashIdx - 4), slashIdx + 1))) return null;
  const q = match[1].toLowerCase();
  const filtered = SLASH_COMMANDS.filter((c) =>
    c.label.toLowerCase().startsWith(q) || (c.detail ?? "").toLowerCase().startsWith(q),
  );
  const options: Completion[] = filtered.map((cmd) => {
    const text = insertText(cmd);
    const cursor = cmd.cursor ?? text.length;
    return {
      label: cmd.label,
      detail: cmd.detail ?? (cmd.insert.length > 12 ? "markdown" : undefined),
      type: "command",
      apply: (view, _completion, from, to) => {
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + cursor },
        });
        view.focus();
      },
    };
  });
  if (options.length === 0) return null;
  return {
    from: match.index! + match[0].indexOf("/"),
    options,
    validFor: /^[^\s]*$/,
  };
}

/** Autocompletion extension for `/`-prefixed markdown commands. */
export const slashCompletion = autocompletion({
  override: [slashCompletionSource],
  activateOnTyping: true,
});
