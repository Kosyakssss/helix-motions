import type { Text } from "@codemirror/state";

interface Exports {
  memory: WebAssembly.Memory;
  rx_alloc(len: number): number;
  rx_free(ptr: number, len: number): void;
  rx_compile(ptr: number, len: number, caseInsensitive: number, crlf: number): number;
  rx_error_ptr(): number;
  rx_error_len(): number;
  rx_drop(regex: number): void;
  rx_find(regex: number, ptr: number, len: number, start: number, end: number, out: number): number;
  rx_find_last(regex: number, ptr: number, len: number, start: number, end: number, out: number): number;
  rx_find_all(regex: number, ptr: number, len: number, start: number, end: number, out: number, capacity: number): number;
  rx_is_match(regex: number, ptr: number, len: number, start: number, end: number): number;
}

class Haystack {
  readonly ptr: number;
  readonly len: number;
  private readonly byteAt: Uint32Array;
  private readonly posAt: Uint32Array;

  constructor(
    private readonly x: Exports,
    readonly doc: Text,
  ) {
    const text = doc.toString();
    const utf8 = new TextEncoder().encode(text);
    this.len = utf8.length;
    this.ptr = x.rx_alloc(this.len);
    new Uint8Array(x.memory.buffer).set(utf8, this.ptr);
    this.byteAt = new Uint32Array(text.length + 1);
    this.posAt = new Uint32Array(this.len + 1);
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
    return this.byteAt[Math.min(Math.max(pos, 0), this.byteAt.length - 1)]!;
  }

  posOf(byte: number): number {
    return this.posAt[Math.min(byte, this.posAt.length - 1)]!;
  }

  free(): void {
    this.x.rx_free(this.ptr, this.len);
  }
}

export class RustRegexEngine {
  private haystack: Haystack | null = null;
  private readonly out: number;
  private buffer = 0;
  private capacity = 0;

  private constructor(private readonly x: Exports) {
    this.out = x.rx_alloc(8);
  }

  static async load(binary: Uint8Array): Promise<RustRegexEngine> {
    const { instance } = await WebAssembly.instantiate(binary, {});
    return new RustRegexEngine(instance.exports as unknown as Exports);
  }

  compile(pattern: string, caseInsensitive: boolean): number {
    const bytes = new TextEncoder().encode(pattern);
    const ptr = this.x.rx_alloc(bytes.length);
    new Uint8Array(this.x.memory.buffer).set(bytes, ptr);
    const regex = this.x.rx_compile(ptr, bytes.length, caseInsensitive ? 1 : 0, 0);
    this.x.rx_free(ptr, bytes.length);
    if (!regex) {
      const message = new TextDecoder().decode(new Uint8Array(this.x.memory.buffer, this.x.rx_error_ptr(), this.x.rx_error_len()));
      throw new Error(message);
    }
    return regex;
  }

  drop(regex: number): void {
    this.x.rx_drop(regex);
  }

  private hay(doc: Text): Haystack {
    if (this.haystack?.doc !== doc) {
      this.haystack?.free();
      this.haystack = new Haystack(this.x, doc);
    }
    return this.haystack;
  }

  private result(h: Haystack, found: number): [number, number] | null {
    if (!found) return null;
    const words = new Uint32Array(this.x.memory.buffer, this.out, 2);
    return [h.posOf(words[0]!), h.posOf(words[1]!)];
  }

  find(regex: number, doc: Text, from: number, to: number): [number, number] | null {
    const h = this.hay(doc);
    return this.result(h, this.x.rx_find(regex, h.ptr, h.len, h.byteOf(from), h.byteOf(to), this.out));
  }

  findLast(regex: number, doc: Text, from: number, to: number): [number, number] | null {
    const h = this.hay(doc);
    return this.result(h, this.x.rx_find_last(regex, h.ptr, h.len, h.byteOf(from), h.byteOf(to), this.out));
  }

  findAll(regex: number, doc: Text, from: number, to: number): [number, number][] {
    const h = this.hay(doc);
    const start = h.byteOf(from);
    const end = h.byteOf(to);
    let count = this.x.rx_find_all(regex, h.ptr, h.len, start, end, this.buffer, this.capacity);
    if (count > this.capacity) {
      if (this.buffer) this.x.rx_free(this.buffer, this.capacity * 8);
      this.capacity = count;
      this.buffer = this.x.rx_alloc(this.capacity * 8);
      count = this.x.rx_find_all(regex, h.ptr, h.len, start, end, this.buffer, this.capacity);
    }
    const words = new Uint32Array(this.x.memory.buffer, this.buffer, count * 2);
    const out: [number, number][] = [];
    for (let i = 0; i < count; i++) out.push([h.posOf(words[i * 2]!), h.posOf(words[i * 2 + 1]!)]);
    return out;
  }

  isMatch(regex: number, doc: Text, from: number, to: number): boolean {
    const h = this.hay(doc);
    return this.x.rx_is_match(regex, h.ptr, h.len, h.byteOf(from), h.byteOf(to)) !== 0;
  }
}
