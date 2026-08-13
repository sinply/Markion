import { autocompletion, type CompletionContext, type CompletionResult, type Completion } from "@codemirror/autocomplete";
import { wikiStems } from "./wikiIndex";
import { markdownContextFacet } from "./media";

/** Match an unterminated `[[...` right before the cursor. */
const linkMatch = /\[\[([^\]\n]*)$/;

async function createWikiNote(ctx: { vaultRoot: string; docRel: string }, target: string): Promise<string> {
  const { createFile } = await import("../lib/ipc");
  const { useVaultStore } = await import("../stores/vaultStore");
  const docDir = ctx.docRel.includes("/")
    ? ctx.docRel.slice(0, ctx.docRel.lastIndexOf("/"))
    : "";
  const newPath = target.includes("/")
    ? `${target}.md`
    : docDir
      ? `${docDir}/${target}.md`
      : `${target}.md`;
  try {
    await createFile(ctx.vaultRoot, newPath);
    await useVaultStore.getState().loadTree(ctx.vaultRoot);
  } catch {
    // creation failed — the link still inserts
  }
  return newPath;
}

export function wikilinkCompletionSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(linkMatch);
  if (!match) return null;
  const partial = match.text.replace(/^\[\[/, "");
  const q = partial.toLowerCase();
  const filtered = wikiStems().filter((s) => s.stem.startsWith(q));
  const options: Completion[] = filtered.map(({ stem, path }) => ({
    label: stem,
    detail: path,
    type: "note",
    apply: (view, _completion, from, to) => {
      view.dispatch({ changes: { from, to, insert: `[[${stem}]]` } });
      view.focus();
    },
  }));

  // Only suggest a new note when nothing matches the partial target.
  if (partial && filtered.length === 0) {
    options.push({
      label: `New note: ${partial}`,
      type: "command",
      apply: (view, _completion, from, to) => {
        view.dispatch({ changes: { from, to, insert: `[[${partial}]]` } });
        const ctx = view.state.facet(markdownContextFacet)[0];
        if (ctx) void createWikiNote(ctx, partial);
        view.focus();
      },
    });
  }

  return {
    from: match.from,
    options,
    validFor: /^[^\]\n]*$/,
  };
}

/** Autocompletion extension: offers `[[` targets from the wiki index and a
 *  "new note" entry for untyped targets. Always on (like image paste/drop). */
export const wikilinkCompletion = autocompletion({
  override: [wikilinkCompletionSource],
  activateOnTyping: true,
});
