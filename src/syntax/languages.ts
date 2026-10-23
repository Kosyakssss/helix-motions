import type { Text } from "@codemirror/state";
import { Language, Parser, Query, Runtime } from "./ts";
import { Syntax, type Loader } from "./syntax";

const MARKDOWN_INJECTIONS = `
(fenced_code_block
  (code_fence_content) @injection.shebang @injection.content
  (#set! injection.include-unnamed-children))

(fenced_code_block
  (info_string
    (language) @injection.language)
  (code_fence_content) @injection.content (#set! injection.include-unnamed-children))

((html_block) @injection.content
 (#set! injection.language "html")
 (#set! injection.include-unnamed-children)
 (#set! injection.combined))

((pipe_table_cell) @injection.content (#set! injection.language "markdown.inline") (#set! injection.include-unnamed-children))

((minus_metadata) @injection.content (#set! injection.language "yaml") (#set! injection.include-unnamed-children))
((plus_metadata) @injection.content (#set! injection.language "toml") (#set! injection.include-unnamed-children))

((inline) @injection.content (#set! injection.language "markdown.inline") (#set! injection.include-unnamed-children))
`;

export async function createLoader(binary: Uint8Array): Promise<Loader> {
  const rt = await Runtime.load(binary);
  const markdown = new Language(rt, rt.x.hm_language(0));
  const markdownInline = new Language(rt, rt.x.hm_language(1));
  return {
    rt,
    parser: new Parser(rt),
    languages: [
      { id: "markdown", injectionRegex: /md|markdown/, grammar: markdown, injections: new Query(rt, markdown, MARKDOWN_INJECTIONS) },
      { id: "markdown.inline", injectionRegex: /markdown\.inline/, grammar: markdownInline, injections: null },
    ],
  };
}

export function markdownSyntax(loader: Loader, text: string): Syntax {
  return new Syntax(loader, text, loader.languages[0]!);
}

export class SyntaxCache {
  private entries = new Map<unknown, { doc: Text; syntax: Syntax }>();

  constructor(
    private readonly loader: Loader,
    private readonly limit = 8,
  ) {}

  get(key: unknown, doc: Text): Syntax {
    const entry = this.entries.get(key);
    if (entry && entry.doc === doc) {
      this.entries.delete(key);
      this.entries.set(key, entry);
      return entry.syntax;
    }
    entry?.syntax.delete();
    this.entries.delete(key);
    const syntax = markdownSyntax(this.loader, doc.toString());
    this.entries.set(key, { doc, syntax });
    for (const [oldKey, old] of this.entries) {
      if (this.entries.size <= this.limit) break;
      old.syntax.delete();
      this.entries.delete(oldKey);
    }
    return syntax;
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.syntax.delete();
    this.entries.clear();
  }
}
