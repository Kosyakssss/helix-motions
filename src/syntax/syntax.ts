import type { ChangeSet, Text } from "@codemirror/state";
import type { InjectionMatch, InjectionQuery, Language, Node, Parser, Runtime, Tree, TreeCursor as TSCursor } from "./ts";

export interface LanguageConfig {
  id: string;
  injectionRegex: RegExp | null;
  grammar: Language;
  injections: InjectionQuery | null;
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
  matchedNodeRange: ByteRange;
}

interface Flags {
  reused: boolean;
  modified: boolean;
  moved: boolean;
  touched: boolean;
}

export interface Edit {
  start: number;
  oldEnd: number;
  newEnd: number;
}

const MAX = 0xffffffff;

function freshFlags(): Flags {
  return { reused: false, modified: false, moved: false, touched: false };
}

export class Layer {
  tree: Tree | null = null;
  injections: Injection[] = [];
  ranges: ByteRange[] = [];
  flags: Flags = freshFlags();
  constructor(
    readonly language: LanguageConfig,
    readonly parent: Layer | null,
  ) {}
}

class Source {
  readonly utf8: Uint8Array;
  readonly ptr: number;
  private maps: { byteAt: Uint32Array; posAt: Uint32Array } | null = null;

  constructor(
    private readonly rt: Runtime,
    readonly text: string,
  ) {
    this.utf8 = new TextEncoder().encode(text);
    this.ptr = rt.alloc(this.utf8);
  }

  private build(): { byteAt: Uint32Array; posAt: Uint32Array } {
    if (this.maps) return this.maps;
    const text = this.text;
    const byteAt = new Uint32Array(text.length + 1);
    const posAt = new Uint32Array(this.utf8.length + 1);
    let byte = 0;
    for (let pos = 0; pos < text.length; ) {
      const code = text.codePointAt(pos)!;
      const units = code > 0xffff ? 2 : 1;
      const bytes = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
      for (let u = 0; u < units; u++) byteAt[pos + u] = byte;
      for (let b = 0; b < bytes; b++) posAt[byte + b] = pos;
      pos += units;
      byte += bytes;
    }
    byteAt[text.length] = byte;
    posAt[byte] = text.length;
    this.maps = { byteAt, posAt };
    return this.maps;
  }

  byteOf(pos: number): number {
    const { byteAt } = this.build();
    return byteAt[Math.min(Math.max(pos, 0), byteAt.length - 1)]!;
  }

  posOf(byte: number): number {
    const { posAt } = this.build();
    return posAt[Math.min(byte, posAt.length - 1)]!;
  }

  free(): void {
    this.rt.x.hm_free(this.ptr);
  }
}

function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

export class Syntax {
  readonly root: Layer;
  private readonly layers = new Set<Layer>();
  private readonly cursors = new Set<TSCursor>();
  private source: Source;

  constructor(
    private readonly loader: Loader,
    text: string,
    language: LanguageConfig,
  ) {
    this.root = new Layer(language, null);
    this.root.ranges = [[0, MAX]];
    this.layers.add(this.root);
    this.source = new Source(loader.rt, text);
    this.update([]);
  }

  byteOf(pos: number): number {
    return this.source.byteOf(pos);
  }

  posOf(byte: number): number {
    return this.source.posOf(byte);
  }

  slice(start: number, end: number): string {
    return new TextDecoder().decode(this.source.utf8.subarray(start, end));
  }

  get byteLength(): number {
    return this.source.utf8.length;
  }

  applyChanges(changes: ChangeSet, newDoc: Text): void {
    const old = this.source;
    const edits: Edit[] = [];
    changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      const start = old.byteOf(fromA);
      edits.push({ start, oldEnd: old.byteOf(toA), newEnd: start + utf8Length(inserted.toString()) });
    });
    this.source = new Source(this.loader.rt, newDoc.toString());
    old.free();
    this.update(edits);
  }

  private update(edits: Edit[]): void {
    const queue: Layer[] = [this.root];
    this.root.flags.touched = true;
    this.root.flags.modified = true;
    while (queue.length > 0) {
      const layer = queue.pop()!;
      if (layer.ranges.length === 0) continue;
      if (layer.tree) {
        if (layer.flags.moved || layer.flags.modified) {
          for (let i = edits.length - 1; i >= 0; i--) layer.tree.edit(edits[i]!.start, edits[i]!.oldEnd, edits[i]!.newEnd);
        }
        if (layer.flags.modified) this.parse(layer);
      } else {
        this.parse(layer);
      }
      this.runInjectionQuery(layer, edits, (child) => queue.push(child));
    }
    for (const layer of this.layers) {
      if (!layer.flags.touched) {
        layer.tree?.delete();
        layer.tree = null;
        this.layers.delete(layer);
      }
      layer.flags = freshFlags();
    }
  }

  private parse(layer: Layer): void {
    const ranges = layer === this.root ? null : layer.ranges.map(([start, end]) => ({ start, end }));
    let old = layer.tree;
    if (old && layer !== this.root) {
      const first = layer.ranges[0]?.[0] ?? 0;
      const last = layer.ranges[layer.ranges.length - 1]?.[1] ?? MAX;
      const root = old.rootNode;
      if (!(root.startByte <= first && root.endByte >= last)) old = null;
    }
    const tree = this.loader.parser.parse(layer.language.grammar, this.source.ptr, this.source.utf8.length, ranges, old);
    if (!tree) throw new Error("tree-sitter parse failed");
    layer.tree?.delete();
    layer.tree = tree;
  }

  treeOf(layer: Layer): Tree {
    return layer.tree!;
  }

  injectionAtByteIdx(layer: Layer, idx: number): Injection | null {
    const injections = layer.injections;
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
    let layer: Layer | null = this.layerForByteRange(start, end);
    while (layer && !layer.tree) layer = layer.parent;
    return (layer ?? this.root).tree!;
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
    for (const layer of this.layers) {
      layer.tree?.delete();
      layer.tree = null;
    }
    this.layers.clear();
    this.source.free();
  }

  private mapInjections(layer: Layer, edits: Edit[]): void {
    if (edits.length === 0) return;
    const injections = layer.injections;
    let first = 0;
    while (first < injections.length && injections[first]!.range[1] < edits[0]!.start) first++;
    if (first === injections.length) return;
    let offset = 0;
    let e = 0;
    const shift = (edit: Edit) => edit.newEnd - edit.oldEnd;
    for (let i = first; i < injections.length; i++) {
      const injection = injections[i]!;
      const range = injection.range;
      const node = injection.matchedNodeRange;
      const flags = injection.layer.flags;
      while (e < edits.length && edits[e]!.oldEnd < node[0]) offset += shift(edits[e++]!);
      let mappedNodeStart = node[0] + offset;
      if (e < edits.length && edits[e]!.start <= node[0]) mappedNodeStart = edits[e]!.newEnd + offset;
      while (e < edits.length && edits[e]!.oldEnd < range[0]) offset += shift(edits[e++]!);
      flags.moved = offset !== 0;
      let mappedStart = range[0] + offset;
      if (e < edits.length && edits[e]!.oldEnd <= range[1]) {
        const edit = edits[e++]!;
        if (edit.start < range[0]) {
          flags.moved = true;
          mappedStart = edit.newEnd + offset;
        } else {
          flags.modified = true;
        }
        offset += shift(edit);
        while (e < edits.length && edits[e]!.oldEnd <= range[1]) offset += shift(edits[e++]!);
      }
      let mappedEnd = range[1] + offset;
      if (e < edits.length && edits[e]!.start <= range[1]) {
        flags.modified = true;
        if (edits[e]!.start < range[0]) {
          mappedStart = edits[e]!.newEnd + offset;
          mappedEnd = mappedStart;
        }
      }
      let mappedNodeEnd = node[1] + offset;
      if (e < edits.length && edits[e]!.start <= node[1] && edits[e]!.start < node[0]) {
        mappedNodeStart = edits[e]!.newEnd + offset;
        mappedNodeEnd = mappedNodeStart;
      }
      injection.range = [mappedStart, mappedEnd];
      injection.matchedNodeRange = [mappedNodeStart, mappedNodeEnd];
    }
  }

  private runInjectionQuery(layer: Layer, edits: Edit[], parseLayer: (layer: Layer) => void): void {
    this.mapInjections(layer, edits);
    const query = layer.language.injections;
    if (!query || !layer.tree) return;
    const parentRanges = layer.ranges;
    const injections: Injection[] = [];
    const old = layer.injections;
    let oi = 0;
    for (const mat of this.matches(query, layer.tree.rootNode)) {
      const matched: ByteRange = [mat.start, mat.end];
      let insertPosition = injections.length;
      const last = injections[injections.length - 1];
      if (last && rangesIntersect(last.range, matched)) {
        if (last.range[0] <= matched[0]) continue;
        insertPosition = injections.findIndex((injection) => injection.range[1] > matched[0]);
        if (injections[insertPosition]!.range[0] < matched[1]) continue;
      }
      while (oi < old.length && old[oi]!.range[1] <= matched[0]) old[oi++]!.layer.flags.modified = true;
      let reused: Injection | null = null;
      const candidate = old[oi];
      if (candidate && candidate.range[0] < matched[1] && candidate.layer.language === mat.language && !candidate.layer.flags.reused) {
        reused = candidate;
        oi++;
      }
      const child = this.initInjection(layer, mat.language, reused);
      if (!child.flags.touched) {
        child.flags.touched = true;
        parseLayer(child);
      }
      if (child.flags.reused) {
        child.flags.modified ||=
          !reused || reused.matchedNodeRange[0] !== matched[0] || reused.matchedNodeRange[1] !== matched[1] || reused.layer !== child;
      }
      const added: Injection[] = [];
      for (const range of intersectRanges(matched, mat.excluded, parentRanges)) {
        child.ranges.push(range);
        added.push({ range, layer: child, matchedNodeRange: matched });
      }
      injections.splice(insertPosition, 0, ...added);
    }
    for (; oi < old.length; oi++) old[oi]!.layer.flags.modified = true;
    layer.injections = injections;
  }

  private initInjection(parent: Layer, language: LanguageConfig, reuse: Injection | null): Layer {
    if (reuse) {
      reuse.layer.flags.reused = true;
      reuse.layer.ranges = [];
      return reuse.layer;
    }
    const layer = new Layer(language, parent);
    this.layers.add(layer);
    return layer;
  }

  private matches(query: InjectionQuery, root: Node): ResolvedMatch[] {
    const found = query.matches(root);
    found.sort((a, b) => a.start - b.start || a.pattern - b.pattern);
    const result: ResolvedMatch[] = [];
    for (const match of found) {
      if (match.end <= match.start) continue;
      const language = this.resolve(query, match);
      if (language) result.push({ ...match, language });
    }
    return result;
  }

  private resolve(query: InjectionQuery, match: InjectionMatch): LanguageConfig | null {
    const languages = this.loader.languages;
    if (match.languageRange) {
      const text = this.slice(match.languageRange[0], match.languageRange[1]);
      const exact = languages.find((l) => l.id === text);
      if (exact) return exact;
      let best: LanguageConfig | null = null;
      let bestLength = 0;
      for (const language of languages) {
        const found = language.injectionRegex?.exec(text);
        if (found && found[0].length > bestLength) {
          best = language;
          bestLength = found[0].length;
        }
      }
      return best;
    }
    if (match.shebang) return null;
    const name = query.properties(match.pattern)["injection.language"];
    return typeof name === "string" ? (languages.find((l) => l.id === name) ?? null) : null;
  }
}

interface ResolvedMatch extends InjectionMatch {
  language: LanguageConfig;
}

function rangesIntersect(a: ByteRange, b: ByteRange): boolean {
  return a[0] === b[0] || (a[1] > b[0] && b[1] > a[0]);
}

function intersectRanges(range: ByteRange, excluded: ByteRange[], parentRanges: ByteRange[]): ByteRange[] {
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
