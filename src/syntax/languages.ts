import type { ChangeSet, Text } from "@codemirror/state";
import { InjectionQuery, Language, Parser, Query, Runtime } from "./ts";
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
      { id: "markdown", injectionRegex: /md|markdown/, grammar: markdown, injections: new InjectionQuery(rt, new Query(rt, markdown, MARKDOWN_INJECTIONS)) },
      { id: "markdown.inline", injectionRegex: /markdown\.inline/, grammar: markdownInline, injections: null },
    ],
  };
}

export function markdownSyntax(loader: Loader, text: string): Syntax {
  return new Syntax(loader, text, loader.languages[0]!);
}

interface Pending {
  changes: ChangeSet;
  newDoc: Text;
}

interface Session {
  doc: Text;
  syntax: Syntax | null;
  pending: Pending[];
}

export class SyntaxSessions {
  private entries = new Map<unknown, Session>();
  private idle = false;

  constructor(
    private readonly loader: Loader,
    private readonly schedule: ((work: () => void) => void) | null = null,
  ) {}

  open(key: unknown, doc: Text): void {
    if (this.entries.has(key)) return;
    this.entries.set(key, { doc, syntax: null, pending: [] });
    this.scheduleIdle();
  }

  change(key: unknown, oldDoc: Text, changes: ChangeSet, newDoc: Text): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    const last = entry.pending.length > 0 ? entry.pending[entry.pending.length - 1]!.newDoc : entry.doc;
    if (last !== oldDoc) {
      this.close(key);
      this.open(key, newDoc);
      return;
    }
    entry.pending.push({ changes, newDoc });
    this.scheduleIdle();
  }

  get(key: unknown, doc: Text): Syntax {
    let entry = this.entries.get(key);
    if (entry) this.flush(entry);
    if (!entry || entry.doc !== doc) {
      this.close(key);
      this.open(key, doc);
      entry = this.entries.get(key)!;
      this.flush(entry);
    }
    return entry.syntax!;
  }

  close(key: unknown): void {
    this.entries.get(key)?.syntax?.delete();
    this.entries.delete(key);
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.syntax?.delete();
    this.entries.clear();
  }

  private flush(entry: Session): Syntax {
    entry.syntax ??= markdownSyntax(this.loader, entry.doc.toString());
    for (const { changes, newDoc } of entry.pending.splice(0)) {
      entry.syntax.applyChanges(changes, newDoc);
      entry.doc = newDoc;
    }
    return entry.syntax;
  }

  private scheduleIdle(): void {
    if (!this.schedule || this.idle) return;
    this.idle = true;
    this.schedule(() => {
      this.idle = false;
      for (const entry of this.entries.values()) this.flush(entry);
    });
  }
}
