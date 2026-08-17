import MarkdownIt from "markdown-it";
import { common, createLowlight } from "lowlight";
// Extra languages beyond lowlight's `common` set — hardware/embedded notes
// (Verilog, VHDL, MATLAB) plus widely-used languages (Scala, functional,
// scripting, config) so fenced blocks highlight instead of falling back to
// plain text.
import verilog from "highlight.js/lib/languages/verilog";
import matlab from "highlight.js/lib/languages/matlab";
import vhdl from "highlight.js/lib/languages/vhdl";
import scala from "highlight.js/lib/languages/scala";
import groovy from "highlight.js/lib/languages/groovy";
import clojure from "highlight.js/lib/languages/clojure";
import haskell from "highlight.js/lib/languages/haskell";
import elixir from "highlight.js/lib/languages/elixir";
import erlang from "highlight.js/lib/languages/erlang";
import ocaml from "highlight.js/lib/languages/ocaml";
import fsharp from "highlight.js/lib/languages/fsharp";
import powershell from "highlight.js/lib/languages/powershell";
import dart from "highlight.js/lib/languages/dart";
import julia from "highlight.js/lib/languages/julia";
import lisp from "highlight.js/lib/languages/lisp";
import scheme from "highlight.js/lib/languages/scheme";
import prolog from "highlight.js/lib/languages/prolog";
import fortran from "highlight.js/lib/languages/fortran";
import glsl from "highlight.js/lib/languages/glsl";
import latex from "highlight.js/lib/languages/latex";
import arduino from "highlight.js/lib/languages/arduino";
import cmake from "highlight.js/lib/languages/cmake";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import nginx from "highlight.js/lib/languages/nginx";
import gradle from "highlight.js/lib/languages/gradle";
import vim from "highlight.js/lib/languages/vim";
import tcl from "highlight.js/lib/languages/tcl";
import nim from "highlight.js/lib/languages/nim";
import nix from "highlight.js/lib/languages/nix";
import crystal from "highlight.js/lib/languages/crystal";
import coffeescript from "highlight.js/lib/languages/coffeescript";
import elm from "highlight.js/lib/languages/elm";
import haxe from "highlight.js/lib/languages/haxe";
import gherkin from "highlight.js/lib/languages/gherkin";

const lowlight = createLowlight(common);

lowlight.register({
  verilog,
  matlab,
  vhdl,
  scala,
  groovy,
  clojure,
  haskell,
  elixir,
  erlang,
  ocaml,
  fsharp,
  powershell,
  dart,
  julia,
  lisp,
  scheme,
  prolog,
  fortran,
  glsl,
  latex,
  arduino,
  cmake,
  dockerfile,
  nginx,
  gradle,
  vim,
  tcl,
  nim,
  nix,
  crystal,
  coffeescript,
  elm,
  haxe,
  gherkin,
});

const md = new MarkdownIt({ html: false, linkify: true });
md.enable(["table", "strikethrough"]);

/** Render full markdown to HTML. Used by block widgets. */
export function renderMarkdown(src: string): string {
  return md.render(src);
}

/** Render inline markdown only (no block wrappers). */
export function renderMarkdownInline(src: string): string {
  return md.renderInline(src);
}

/** Syntax-highlight a code block using lowlight, keyed by the fence language.
 *  Falls back to escaped plain text for unknown languages. */
export function highlightCode(code: string, lang: string): string {
  if (lang && lowlight.registered(lang)) {
    try {
      const root = lowlight.highlight(lang, code);
      return hastToHtml(root);
    } catch {
      // ignore highlight errors — fall through to escaped plain text
    }
  }
  return escapeHtml(code);
}

/** Render markdown to HTML, injecting each table cell's raw inline source as a
 *  `data-source` attribute. The token stream preserves cell source (e.g. `*em*`)
 *  that the rendered HTML drops, so table edit-in-place can preserve formats.
 *
 *  Note: the th/td render rules are temporarily overridden on the shared `md`
 *  instance and restored afterwards, so `renderMarkdown` (used by the full-doc
 *  preview) is not permanently polluted with the data-source injection. */
export function renderMarkdownWithTableSource(src: string): string {
  const thDefault = md.renderer.rules.th_open;
  const tdDefault = md.renderer.rules.td_open;
  md.renderer.rules.th_open = (tokens: any, idx: number, options: any, env: any, self: any) => {
    const token = tokens[idx];
    const next = tokens[idx + 1];
    if (next && next.type === "inline") token.attrSet("data-source", next.content);
    return self.renderToken(tokens, idx, options);
  };
  md.renderer.rules.td_open = (tokens: any, idx: number, options: any, env: any, self: any) => {
    const token = tokens[idx];
    const next = tokens[idx + 1];
    if (next && next.type === "inline") token.attrSet("data-source", next.content);
    return self.renderToken(tokens, idx, options);
  };
  try {
    return md.render(src);
  } finally {
    md.renderer.rules.th_open = thDefault;
    md.renderer.rules.td_open = tdDefault;
  }
}

/** Serialize a HAST (lowlight v3) node to HTML.
 *  Handles lowlight's className arrays (output as class="a b") and
 *  escapes attribute values. */
function hastToHtml(node: any): string {
  if (node.type === "text") return escapeHtml(node.value ?? "");
  if (node.type === "element") {
    const tag = node.tagName ?? "span";
    const props = node.properties ?? {};
    const parts: string[] = [];
    for (const [k, v] of Object.entries(props)) {
      const attr = k === "className" ? "class" : k;
      const val = Array.isArray(v) ? v.join(" ") : String(v);
      parts.push(` ${attr}="${escapeAttr(val)}"`);
    }
    const children = (node.children ?? []).map(hastToHtml).join("");
    return `<${tag}${parts.join("")}>${children}</${tag}>`;
  }
  if (node.type === "root") {
    return (node.children ?? []).map(hastToHtml).join("");
  }
  return "";
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
