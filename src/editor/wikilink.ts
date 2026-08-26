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

/** Match quality for a stem against the typed partial: 0 = prefix,
 *  1 = after a separator (word boundary), 2 = substring anywhere,
 *  -1 = no match. Empty query matches everything equally. */
function rankStem(stem: string, q: string): number {
  if (!q) return 3;
  const l = stem.toLowerCase();
  const i = l.indexOf(q);
  if (i === 0) return 0;
  if (i > 0) return /[\s\-_/]/.test(l[i - 1]) ? 1 : 2;
  return -1;
}

const MAX_WIKI_OPTIONS = 60;

export function wikilinkCompletionSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(linkMatch);
  if (!match) return null;
  const partial = match.text.replace(/^\[\[/, "");
  const q = partial.toLowerCase();
  // Substring/fuzzy-aware ranking (prefix hits first, then word boundaries,
  // then any substring) — a plain startsWith() used to hide notes whose name
  // merely CONTAINED the typed fragment.
  const filtered = wikiStems()
    .map((s) => ({ ...s, score: rankStem(s.stem, q) }))
    .filter((s) => s.score >= 0)
    .sort((a, b) => a.score - b.score) // Array#sort is stable: ties keep index order
    .slice(0, MAX_WIKI_OPTIONS);
  const options: Completion[] = filtered.map(({ stem, path }) => ({
    label: stem,
    detail: path,
    type: "note",
    apply: (view, _completion, from, to) => {
      view.dispatch({ changes: { from, to, insert: `[[${stem}]]` } });
      view.focus();
    },
  }));

  // Suggest a new note whenever the EXACT typed target does not exist yet —
  // even when fuzzy matches do (Obsidian-style: both are useful).
  const hasExact = wikiStems().some((s) => s.stem.toLowerCase() === q);
  if (partial && !hasExact) {
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
