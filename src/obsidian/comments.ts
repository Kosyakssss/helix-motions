import type { Text } from "@codemirror/state";
import type { CommentTokens } from "../commands/comments";

const SLASH = { line: ["//"], block: [{ start: "/*", end: "*/" }] };
const HASH = { line: ["#"], block: null };
const DASH = { line: ["--"], block: null };
const HTML = { line: null, block: [{ start: "<!--", end: "-->" }] };

const LANGS: Record<string, CommentTokens> = {
  js: SLASH, javascript: SLASH, ts: SLASH, typescript: SLASH, jsx: SLASH, tsx: SLASH, java: SLASH, c: SLASH,
  cpp: SLASH, "c++": SLASH, cs: SLASH, csharp: SLASH, rust: SLASH, rs: SLASH, go: SLASH, swift: SLASH,
  kotlin: SLASH, kt: SLASH, scala: SLASH, dart: SLASH, php: SLASH, zig: SLASH, json5: SLASH,
  css: { line: null, block: [{ start: "/*", end: "*/" }] }, scss: SLASH, less: SLASH,
  python: HASH, py: HASH, sh: HASH, bash: HASH, zsh: HASH, fish: HASH, shell: HASH, yaml: HASH, yml: HASH,
  toml: HASH, ruby: HASH, rb: HASH, r: HASH, perl: HASH, nix: HASH, dockerfile: HASH, make: HASH, makefile: HASH,
  lua: { line: ["--"], block: [{ start: "--[[", end: "]]" }] }, sql: DASH, haskell: DASH, hs: DASH, elm: DASH,
  html: HTML, xml: HTML, svg: HTML, vue: HTML,
  lisp: { line: [";"], block: null }, clojure: { line: [";"], block: null }, scheme: { line: [";"], block: null },
  vim: { line: ['"'], block: null }, tex: { line: ["%"], block: null }, latex: { line: ["%"], block: null },
};

const MARKDOWN: CommentTokens = { line: null, block: [{ start: "%%", end: "%%" }] };

export function commentTokensAt(doc: Text, pos: number): CommentTokens {
  const lineNo = doc.lineAt(pos).number;
  let lang: string | null = null;
  let inside = false;
  for (let i = 1; i <= lineNo; i++) {
    const text = doc.line(i).text;
    const m = /^\s*(```+|~~~+)\s*([\w+#-]*)/.exec(text);
    if (!m) continue;
    if (!inside) {
      if (i === lineNo) break;
      inside = true;
      lang = m[2]!.toLowerCase();
    } else {
      inside = false;
      lang = null;
    }
  }
  if (inside && lang) return LANGS[lang] ?? { line: null, block: null };
  return MARKDOWN;
}
