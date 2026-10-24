interface Exports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  hm_malloc(size: number): number;
  hm_free(ptr: number): void;
  hm_language(which: number): number;
  hm_symbol_name(language: number, symbol: number): number;
  hm_parse(language: number, text: number, length: number, ranges: number, count: number, oldTree: number): number;
  hm_tree_edit(tree: number, start: number, oldEnd: number, newEnd: number): void;
  hm_injection_matches(
    query: number,
    node: number,
    modes: number,
    content: number,
    language: number,
    shebang: number,
    buffer: number,
    capacity: number,
  ): number;
  hm_tree_delete(tree: number): void;
  hm_tree_root(tree: number, out: number): void;
  hm_node_start(node: number): number;
  hm_node_end(node: number): number;
  hm_node_symbol(node: number): number;
  hm_node_is_named(node: number): number;
  hm_node_child_count(node: number): number;
  hm_node_child(node: number, index: number, out: number): void;
  hm_node_parent(node: number, out: number): void;
  hm_node_next_sibling(node: number, out: number): void;
  hm_node_prev_sibling(node: number, out: number): void;
  hm_node_descendant(node: number, start: number, end: number, named: number, out: number): void;
  hm_cursor_new(node: number): number;
  hm_cursor_delete(cursor: number): void;
  hm_cursor_node(cursor: number, out: number): void;
  hm_cursor_parent(cursor: number): number;
  hm_cursor_first_child(cursor: number): number;
  hm_cursor_next_sibling(cursor: number): number;
  hm_cursor_prev_sibling(cursor: number): number;
  hm_cursor_first_child_for_byte(cursor: number, goal: number): number;
  hm_query_new(language: number, source: number, length: number): number;
  hm_query_capture_count(query: number): number;
  hm_query_pattern_count(query: number): number;
  hm_query_capture_name(query: number, index: number, length: number): number;
  hm_query_string(query: number, index: number, length: number): number;
  hm_query_predicates(query: number, pattern: number, length: number): number;
}

const NODE_WORDS = 6;
const NODE_BYTES = NODE_WORDS * 4;
const ENOSYS = 52;

export class Runtime {
  private readonly scratch: number;
  private words: Uint32Array;
  private bytes: Uint8Array;

  private constructor(readonly x: Exports) {
    this.scratch = x.hm_malloc(NODE_BYTES * 2 + 16);
    this.words = new Uint32Array(x.memory.buffer);
    this.bytes = new Uint8Array(x.memory.buffer);
  }

  static async load(binary: Uint8Array): Promise<Runtime> {
    const stub = () => ENOSYS;
    const { instance } = await WebAssembly.instantiate(binary, {
      wasi_snapshot_preview1: { fd_close: stub, fd_seek: stub, fd_write: stub },
    });
    const x = instance.exports as unknown as Exports;
    x._initialize();
    return new Runtime(x);
  }

  u32(): Uint32Array {
    if (this.words.buffer !== this.x.memory.buffer) this.words = new Uint32Array(this.x.memory.buffer);
    return this.words;
  }

  u8(): Uint8Array {
    if (this.bytes.buffer !== this.x.memory.buffer) this.bytes = new Uint8Array(this.x.memory.buffer);
    return this.bytes;
  }

  get inPtr(): number {
    return this.scratch;
  }

  get outPtr(): number {
    return this.scratch + NODE_BYTES;
  }

  get lenPtr(): number {
    return this.scratch + NODE_BYTES * 2;
  }

  writeNode(ptr: number, node: Node): void {
    this.u32().set(node.raw, ptr >> 2);
  }

  readNode(ptr: number): Node | null {
    const words = this.u32();
    const raw = words.slice(ptr >> 2, (ptr >> 2) + NODE_WORDS);
    return raw[4] === 0 ? null : new Node(this, raw);
  }

  string(ptr: number, length: number): string {
    return new TextDecoder().decode(this.u8().subarray(ptr, ptr + length));
  }

  cString(ptr: number): string {
    const bytes = this.u8();
    let end = ptr;
    while (bytes[end] !== 0) end++;
    return new TextDecoder().decode(bytes.subarray(ptr, end));
  }

  alloc(data: Uint8Array): number {
    const ptr = this.x.hm_malloc(Math.max(1, data.length));
    this.u8().set(data, ptr);
    return ptr;
  }

  nodeCall(node: Node, f: (inPtr: number, outPtr: number) => void): Node | null {
    this.writeNode(this.inPtr, node);
    f(this.inPtr, this.outPtr);
    return this.readNode(this.outPtr);
  }

  nodeValue(node: Node, f: (inPtr: number) => number): number {
    this.writeNode(this.inPtr, node);
    return f(this.inPtr);
  }
}

export class Language {
  private readonly names = new Map<number, string>();
  constructor(
    readonly rt: Runtime,
    readonly ptr: number,
  ) {}

  symbolName(symbol: number): string {
    let name = this.names.get(symbol);
    if (name === undefined) {
      name = this.rt.cString(this.rt.x.hm_symbol_name(this.ptr, symbol));
      this.names.set(symbol, name);
    }
    return name;
  }
}

export class Node {
  constructor(
    readonly rt: Runtime,
    readonly raw: Uint32Array,
  ) {}

  get startByte(): number {
    return this.rt.nodeValue(this, (p) => this.rt.x.hm_node_start(p));
  }

  get endByte(): number {
    return this.rt.nodeValue(this, (p) => this.rt.x.hm_node_end(p));
  }

  get symbol(): number {
    return this.rt.nodeValue(this, (p) => this.rt.x.hm_node_symbol(p));
  }

  get isNamed(): boolean {
    return this.rt.nodeValue(this, (p) => this.rt.x.hm_node_is_named(p)) !== 0;
  }

  get childCount(): number {
    return this.rt.nodeValue(this, (p) => this.rt.x.hm_node_child_count(p));
  }

  child(index: number): Node | null {
    return this.rt.nodeCall(this, (p, o) => this.rt.x.hm_node_child(p, index, o));
  }

  get children(): Node[] {
    const out: Node[] = [];
    const count = this.childCount;
    for (let i = 0; i < count; i++) out.push(this.child(i)!);
    return out;
  }

  get parent(): Node | null {
    return this.rt.nodeCall(this, (p, o) => this.rt.x.hm_node_parent(p, o));
  }

  get nextSibling(): Node | null {
    return this.rt.nodeCall(this, (p, o) => this.rt.x.hm_node_next_sibling(p, o));
  }

  get previousSibling(): Node | null {
    return this.rt.nodeCall(this, (p, o) => this.rt.x.hm_node_prev_sibling(p, o));
  }

  descendantForByteRange(start: number, end: number): Node | null {
    return this.rt.nodeCall(this, (p, o) => this.rt.x.hm_node_descendant(p, start, end, 0, o));
  }

  namedDescendantForByteRange(start: number, end: number): Node | null {
    return this.rt.nodeCall(this, (p, o) => this.rt.x.hm_node_descendant(p, start, end, 1, o));
  }

  equals(other: Node): boolean {
    return this.raw[4] === other.raw[4] && this.raw[5] === other.raw[5];
  }
}

export interface ByteRange {
  start: number;
  end: number;
}

export class Tree {
  constructor(
    readonly rt: Runtime,
    readonly ptr: number,
  ) {}

  edit(start: number, oldEnd: number, newEnd: number): void {
    this.rt.x.hm_tree_edit(this.ptr, start, oldEnd, newEnd);
  }

  get rootNode(): Node {
    this.rt.x.hm_tree_root(this.ptr, this.rt.outPtr);
    return this.rt.readNode(this.rt.outPtr)!;
  }

  walk(): TreeCursor {
    return new TreeCursor(this.rt, this.rootNode);
  }

  delete(): void {
    this.rt.x.hm_tree_delete(this.ptr);
  }
}

export class TreeCursor {
  private ptr: number;

  constructor(
    readonly rt: Runtime,
    node: Node,
  ) {
    this.ptr = rt.nodeValue(node, (p) => rt.x.hm_cursor_new(p));
  }

  get currentNode(): Node {
    this.rt.x.hm_cursor_node(this.ptr, this.rt.outPtr);
    return this.rt.readNode(this.rt.outPtr)!;
  }

  gotoParent(): boolean {
    return this.rt.x.hm_cursor_parent(this.ptr) !== 0;
  }

  gotoFirstChild(): boolean {
    return this.rt.x.hm_cursor_first_child(this.ptr) !== 0;
  }

  gotoNextSibling(): boolean {
    return this.rt.x.hm_cursor_next_sibling(this.ptr) !== 0;
  }

  gotoPreviousSibling(): boolean {
    return this.rt.x.hm_cursor_prev_sibling(this.ptr) !== 0;
  }

  gotoFirstChildForByte(goal: number): boolean {
    return this.rt.x.hm_cursor_first_child_for_byte(this.ptr, goal) !== 0;
  }

  delete(): void {
    if (this.ptr) this.rt.x.hm_cursor_delete(this.ptr);
    this.ptr = 0;
  }
}

export class Parser {
  constructor(readonly rt: Runtime) {}

  parse(language: Language, text: number, length: number, ranges: ByteRange[] | null, oldTree: Tree | null = null): Tree | null {
    const rt = this.rt;
    let rangesPtr = 0;
    if (ranges && ranges.length > 0) {
      rangesPtr = rt.x.hm_malloc(ranges.length * 24);
      const words = rt.u32();
      ranges.forEach((range, i) => {
        const base = (rangesPtr >> 2) + i * 6;
        words.set([0, 0, 0, 0, range.start, range.end], base);
      });
    }
    const tree = rt.x.hm_parse(language.ptr, text, length, rangesPtr, ranges?.length ?? 0, oldTree?.ptr ?? 0);
    if (rangesPtr) rt.x.hm_free(rangesPtr);
    return tree ? new Tree(rt, tree) : null;
  }
}

export class Query {
  readonly ptr: number;
  readonly captureNames: string[] = [];
  private readonly properties: Record<string, string | null>[] = [];

  constructor(
    readonly rt: Runtime,
    language: Language,
    source: string,
  ) {
    const bytes = new TextEncoder().encode(source);
    const src = rt.alloc(bytes);
    this.ptr = rt.x.hm_query_new(language.ptr, src, bytes.length);
    rt.x.hm_free(src);
    if (!this.ptr) throw new Error("invalid tree-sitter query");
    const lenWord = rt.lenPtr >> 2;
    const text = (ptr: number) => rt.string(ptr, rt.u32()[lenWord]!);
    const captureCount = rt.x.hm_query_capture_count(this.ptr);
    for (let i = 0; i < captureCount; i++) this.captureNames.push(text(rt.x.hm_query_capture_name(this.ptr, i, rt.lenPtr)));
    const patternCount = rt.x.hm_query_pattern_count(this.ptr);
    for (let pattern = 0; pattern < patternCount; pattern++) {
      const steps = rt.x.hm_query_predicates(this.ptr, pattern, rt.lenPtr);
      const count = rt.u32()[lenWord]!;
      const words = rt.u32().slice(steps >> 2, (steps >> 2) + count * 2);
      const props: Record<string, string | null> = {};
      let predicate: number[] = [];
      for (let i = 0; i < count; i++) {
        const type = words[i * 2]!;
        const value = words[i * 2 + 1]!;
        if (type !== 0) {
          predicate.push(type === 2 ? value : -1);
          continue;
        }
        const [name, key, val] = predicate.map((id) => (id < 0 ? "" : text(rt.x.hm_query_string(this.ptr, id, rt.lenPtr))));
        if (name === "set!" && key !== undefined) props[key] = val ?? null;
        predicate = [];
      }
      this.properties.push(props);
    }
  }

  patternProperties(): Record<string, string | null>[] {
    return this.properties;
  }
}

export interface InjectionMatch {
  pattern: number;
  start: number;
  end: number;
  languageRange: [number, number] | null;
  shebang: boolean;
  excluded: [number, number][];
}

export class InjectionQuery {
  private readonly modes: number;
  private readonly ids: [number, number, number];
  private buffer = 0;
  private capacity = 0;

  constructor(
    readonly rt: Runtime,
    readonly query: Query,
  ) {
    const props = query.patternProperties();
    this.modes = rt.alloc(
      new Uint8Array(props.map((p) => ("injection.include-children" in p ? 1 : "injection.include-unnamed-children" in p ? 2 : 0))),
    );
    const id = (name: string) => {
      const i = query.captureNames.indexOf(name);
      return i < 0 ? 0xffffffff : i;
    };
    this.ids = [id("injection.content"), id("injection.language"), id("injection.shebang")];
  }

  properties(pattern: number): Record<string, string | null> {
    return this.query.patternProperties()[pattern] ?? {};
  }

  matches(node: Node): InjectionMatch[] {
    const rt = this.rt;
    let used: number;
    for (;;) {
      rt.writeNode(rt.inPtr, node);
      used = rt.x.hm_injection_matches(this.query.ptr, rt.inPtr, this.modes, this.ids[0], this.ids[1], this.ids[2], this.buffer, this.capacity);
      if (used <= this.capacity) break;
      if (this.buffer) rt.x.hm_free(this.buffer);
      this.capacity = used * 2;
      this.buffer = rt.x.hm_malloc(this.capacity * 4);
    }
    const words = rt.u32().slice(this.buffer >> 2, (this.buffer >> 2) + used);
    const out: InjectionMatch[] = [];
    for (let i = 0; i < used; ) {
      const count = words[i + 6]!;
      const excluded: [number, number][] = [];
      for (let e = 0; e < count; e++) excluded.push([words[i + 8 + e * 2]!, words[i + 9 + e * 2]!]);
      out.push({
        pattern: words[i]!,
        start: words[i + 1]!,
        end: words[i + 2]!,
        languageRange: words[i + 3] === 0xffffffff ? null : [words[i + 3]!, words[i + 4]!],
        shebang: words[i + 5] === 1,
        excluded,
      });
      i += 8 + count * 2;
    }
    return out;
  }
}
