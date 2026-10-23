import type { Language, Node, Parser, Query, QueryMatch, Runtime, Tree, TreeCursor as TSCursor } from "./ts";

export interface LanguageConfig {
  id: string;
  injectionRegex: RegExp | null;
  grammar: Language;
  injections: Query | null;
}

export interface Loader {
  rt: Runtime;
  parser: Parser;
  languages: LanguageConfig[];
}

type ByteRange = [number, number];

interface Injection {
  range: ByteRange;
  layer: Layer;
}

const MAX = 0xffffffff;

export class Layer {
  tree: Tree | null = null;
  injections: Injection[] | null = null;
  readonly ranges: ByteRange[] = [];
  constructor(
    readonly language: LanguageConfig,
    readonly parent: Layer | null,
  ) {}
}

export class Syntax {
  readonly root: Layer;
  private readonly cursors = new Set<TSCursor>();
  private readonly utf8: Uint8Array;
  private textPtr: number;
  private readonly byteAt: Uint32Array;
  private readonly posAt: Uint32Array;

  constructor(
    private readonly loader: Loader,
    text: string,
    language: LanguageConfig,
  ) {
    this.root = new Layer(language, null);
    this.root.ranges.push([0, MAX]);
    this.utf8 = new TextEncoder().encode(text);
    this.textPtr = loader.rt.alloc(this.utf8);
    this.byteAt = new Uint32Array(text.length + 1);
    this.posAt = new Uint32Array(this.utf8.length + 1);
    let byte = 0;
    for (let pos = 0; pos < text.length; ) {
      const code = text.codePointAt(pos)!;
      const units = code > 0xffff ? 2 : 1;
      const bytes = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
      for (let u = 0; u < units; u++) this.byteAt[pos + u] = byte;
      for (let b = 0; b < bytes; b++) this.posAt[byte + b] = pos;
      pos += units;
      byte += bytes;
    }
    this.byteAt[text.length] = byte;
    this.posAt[byte] = text.length;
  }

  byteOf(pos: number): number {
    return this.byteAt[Math.min(pos, this.byteAt.length - 1)]!;
  }

  posOf(byte: number): number {
    return this.posAt[Math.min(byte, this.posAt.length - 1)]!;
  }

  slice(start: number, end: number): string {
    return new TextDecoder().decode(this.utf8.subarray(start, end));
  }

  get byteLength(): number {
    return this.utf8.length;
  }

  treeOf(layer: Layer): Tree {
    if (!layer.tree) {
      const ranges = layer === this.root ? null : layer.ranges.map(([start, end]) => ({ start, end }));
      const tree = this.loader.parser.parse(layer.language.grammar, this.textPtr, this.utf8.length, ranges);
      if (!tree) throw new Error("tree-sitter parse failed");
      layer.tree = tree;
    }
    return layer.tree;
  }

  injectionsOf(layer: Layer): Injection[] {
    if (!layer.injections) layer.injections = this.runInjectionQuery(layer);
    return layer.injections;
  }

  injectionAtByteIdx(layer: Layer, idx: number): Injection | null {
    const injections = this.injectionsOf(layer);
    let lo = 0;
    let hi = injections.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (injections[mid]!.range[1] <= idx) lo = mid + 1;
      else hi = mid;
    }
    const first = injections[lo];
    return first && first.range[0] <= idx ? first : null;
  }

  *layersForByteRange(start: number, end: number): Generator<Layer> {
    let parent = this.root;
    yield parent;
    for (;;) {
      const atStart = this.injectionAtByteIdx(parent, start);
      if (!atStart) return;
      const atEnd = this.injectionAtByteIdx(parent, end);
      if (!atEnd || atStart.layer !== atEnd.layer) return;
      parent = atStart.layer;
      yield parent;
    }
  }

  layerForByteRange(start: number, end: number): Layer {
    let last = this.root;
    for (const layer of this.layersForByteRange(start, end)) last = layer;
    return last;
  }

  treeForByteRange(start: number, end: number): Tree {
    return this.treeOf(this.layerForByteRange(start, end));
  }

  namedDescendantForByteRange(start: number, end: number): Node | null {
    return this.treeForByteRange(start, end).rootNode.namedDescendantForByteRange(start, end);
  }

  descendantForByteRange(start: number, end: number): Node | null {
    return this.treeForByteRange(start, end).rootNode.descendantForByteRange(start, end);
  }

  walk(): SyntaxCursor {
    return new SyntaxCursor(this);
  }

  newCursor(tree: Tree): TSCursor {
    const cursor = tree.walk();
    this.cursors.add(cursor);
    return cursor;
  }

  dropCursor(cursor: TSCursor): void {
    if (this.cursors.delete(cursor)) cursor.delete();
  }

  delete(): void {
    for (const cursor of this.cursors) cursor.delete();
    this.cursors.clear();
    const free = (layer: Layer) => {
      layer.tree?.delete();
      layer.tree = null;
      for (const injection of layer.injections ?? []) if (injection.layer.tree) free(injection.layer);
    };
    free(this.root);
    if (this.textPtr) this.loader.rt.x.hm_free(this.textPtr);
    this.textPtr = 0;
  }

  private runInjectionQuery(layer: Layer): Injection[] {
    const query = layer.language.injections;
    if (!query) return [];
    const tree = this.treeOf(layer);
    const injections: Injection[] = [];
    for (const match of this.matches(query, tree.rootNode)) {
      const nodeRange: ByteRange = [match.node.startByte, match.node.endByte];
      let insertPosition = injections.length;
      const last = injections[injections.length - 1];
      if (last && rangesIntersect(last.range, nodeRange)) {
        if (last.range[0] <= nodeRange[0]) continue;
        insertPosition = injections.findIndex((injection) => injection.range[1] > nodeRange[0]);
        if (injections[insertPosition]!.range[0] < nodeRange[1]) continue;
      }
      const child = new Layer(match.language, layer);
      const added: Injection[] = [];
      for (const range of intersectRanges(match.includeChildren, match.node, layer.ranges)) {
        child.ranges.push(range);
        added.push({ range, layer: child });
      }
      injections.splice(insertPosition, 0, ...added);
    }
    return injections;
  }

  private matches(query: Query, root: Node): InjectionMatch[] {
    const result: InjectionMatch[] = [];
    const found = query.matches(root).map((match) => ({ match, start: contentStart(match) }));
    found.sort((a, b) => a.start - b.start || a.match.patternIndex - b.match.patternIndex);
    for (const { match } of found) {
      const processed = this.processMatch(match);
      if (processed && processed.node.endByte > processed.node.startByte) result.push(processed);
    }
    return result;
  }

  private processMatch(match: QueryMatch): InjectionMatch | null {
    const properties = match.setProperties ?? {};
    let marker: { kind: "match" | "shebang" | "name"; text: string } | null = null;
    let content: Node | null = null;
    for (const capture of match.captures) {
      if (capture.name === "injection.language") {
        marker = { kind: "match", text: this.slice(capture.node.startByte, capture.node.endByte) };
      } else if (capture.name === "injection.shebang") {
        const nodeText = this.slice(capture.node.startByte, capture.node.endByte);
        const lines = nodeText.split("\n").slice(0, 2).join("\n");
        const shebang = SHEBANG.exec(lines);
        marker = shebang ? { kind: "shebang", text: shebang[1]! } : null;
      } else if (capture.name === "injection.content") {
        content = capture.node;
      }
    }
    if (!content) return null;
    if (!marker && typeof properties["injection.language"] === "string") {
      marker = { kind: "name", text: properties["injection.language"] };
    }
    if (!marker) return null;
    const language = this.languageForMarker(marker);
    if (!language) return null;
    const includeChildren: IncludedChildren =
      "injection.include-unnamed-children" in properties ? "unnamed" : "injection.include-children" in properties ? "all" : "none";
    return { language, node: content, includeChildren };
  }

  private languageForMarker(marker: { kind: "match" | "shebang" | "name"; text: string }): LanguageConfig | null {
    const languages = this.loader.languages;
    if (marker.kind === "name") return languages.find((l) => l.id === marker.text) ?? null;
    if (marker.kind === "shebang") return null;
    const exact = languages.find((l) => l.id === marker.text);
    if (exact) return exact;
    let best: LanguageConfig | null = null;
    let bestLength = 0;
    for (const language of languages) {
      const found = language.injectionRegex?.exec(marker.text);
      if (found && found[0].length > bestLength) {
        best = language;
        bestLength = found[0].length;
      }
    }
    return best;
  }
}

type IncludedChildren = "none" | "all" | "unnamed";

interface InjectionMatch {
  language: LanguageConfig;
  node: Node;
  includeChildren: IncludedChildren;
}

const SHEBANG = /#!\s*(?:\S*[/\\](?:env\s+(?:-\S+\s+)*)?)?([^\s.\d]+)/;

function contentStart(match: QueryMatch): number {
  return match.captures.find((c) => c.name === "injection.content")?.node.startByte ?? 0;
}

function rangesIntersect(a: ByteRange, b: ByteRange): boolean {
  return a[0] === b[0] || (a[1] > b[0] && b[1] > a[0]);
}

function intersectRanges(includeChildren: IncludedChildren, node: Node, parentRanges: ByteRange[]): ByteRange[] {
  const range: ByteRange = [node.startByte, node.endByte];
  const excluded: ByteRange[] = [];
  if (includeChildren !== "all") {
    for (const child of node.children) {
      if (includeChildren === "none" || child.isNamed) excluded.push([child.startByte, child.endByte]);
    }
  }
  const parents = excludeRanges(
    parentRanges.filter((r) => r[1] > range[0]),
    excluded,
  );
  const merged: ByteRange[] = [];
  for (const r of parents) {
    const prev = merged[merged.length - 1];
    if (prev && prev[1] === r[0]) prev[1] = r[1];
    else merged.push([r[0], r[1]]);
  }
  const out: ByteRange[] = [];
  let start = range[0];
  for (const parent of merged) {
    if (start >= range[1]) break;
    if (parent[1] <= start) continue;
    if (parent[0] > start) start = parent[0];
    const end = Math.min(range[1], parent[1]);
    if (end > start) out.push([start, end]);
    start = Math.max(start, end);
  }
  return out;
}

function excludeRanges(ranges: ByteRange[], excluded: ByteRange[]): ByteRange[] {
  const exclusions = excluded.filter((r) => r[1] > r[0]);
  const out: ByteRange[] = [];
  let e = 0;
  const queue = ranges.map((r): ByteRange => [r[0], r[1]]);
  let i = 0;
  let next: ByteRange | undefined = queue[i++];
  while (next) {
    const range = next;
    while (e < exclusions.length && exclusions[e]![1] <= range[0]) e++;
    const exclusion = exclusions[e];
    if (exclusion && rangesIntersect(range, exclusion)) {
      const preceding: ByteRange = [range[0], exclusion[0]];
      const remaining: ByteRange = [exclusion[1], range[1]];
      if (remaining[1] > remaining[0]) {
        next = remaining;
        e++;
      } else {
        next = queue[i++];
      }
      if (preceding[1] > preceding[0]) out.push(preceding);
      continue;
    }
    next = queue[i++];
    out.push(range);
  }
  return out;
}

export class SyntaxCursor {
  private current: Layer;
  private cursor: TSCursor;

  constructor(private readonly syntax: Syntax) {
    this.current = syntax.root;
    this.cursor = syntax.newCursor(syntax.treeOf(syntax.root));
  }

  private use(layer: Layer, tree: Tree): void {
    this.syntax.dropCursor(this.cursor);
    this.current = layer;
    this.cursor = this.syntax.newCursor(tree);
  }

  node(): Node {
    return this.cursor.currentNode;
  }

  gotoParent(): boolean {
    if (this.cursor.gotoParent()) return true;
    const parent = this.current.parent;
    if (!parent) return false;
    this.use(parent, this.syntax.treeOf(parent));
    return true;
  }

  gotoParentWith(predicate: (node: Node) => boolean): boolean {
    while (this.gotoParent()) {
      if (predicate(this.node())) return true;
    }
    return false;
  }

  gotoFirstChild(): boolean {
    const node = this.cursor.currentNode;
    const injection = this.syntax.injectionAtByteIdx(this.current, node.startByte);
    if (injection && injection.range[1] >= node.endByte) {
      this.use(injection.layer, this.syntax.treeOf(injection.layer));
      return true;
    }
    return this.cursor.gotoFirstChild();
  }

  gotoNextSibling(): boolean {
    return this.cursor.gotoNextSibling();
  }

  gotoPreviousSibling(): boolean {
    return this.cursor.gotoPreviousSibling();
  }

  resetToByteRange(start: number, end: number): void {
    const layer = this.syntax.layerForByteRange(start, end);
    this.use(layer, this.syntax.treeOf(layer));
    for (;;) {
      const node = this.cursor.currentNode;
      if (start < node.startByte || end > node.endByte) {
        this.cursor.gotoParent();
        break;
      }
      if (!this.cursor.gotoFirstChildForByte(start)) break;
    }
  }

  children(): Node[] {
    const out: Node[] = [];
    if (!this.gotoFirstChild()) return out;
    out.push(this.node());
    while (this.gotoNextSibling()) out.push(this.node());
    return out;
  }

  dispose(): void {
    this.syntax.dropCursor(this.cursor);
  }
}
