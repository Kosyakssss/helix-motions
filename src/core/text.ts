import type { Text } from "@codemirror/state";

const ALNUM = /^[\p{Alphabetic}\p{Nd}\p{Nl}\p{No}]$/u;
const WHITESPACE = /^\p{White_Space}$/u;
const PUNCT = /^[\p{Po}\p{Ps}\p{Pe}\p{Pi}\p{Pf}\p{Pc}\p{Pd}\p{Sm}\p{Sc}\p{Sk}]$/u;
const LOWER = /^\p{Lowercase}$/u;
const UPPER = /^\p{Uppercase}$/u;

export type CharCategory = "whitespace" | "eol" | "word" | "punctuation" | "unknown";

export function charIsLineEnding(ch: string): boolean {
  return ch === "\n" || ch === "\r";
}

export function isWhitespace(ch: string): boolean {
  return WHITESPACE.test(ch);
}

export function charIsWhitespace(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return (
    c === 0x09 ||
    c === 0x20 ||
    c === 0xa0 ||
    c === 0x180e ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff ||
    (c >= 0x2000 && c <= 0x200b)
  );
}

export function isAlphanumeric(ch: string): boolean {
  return ALNUM.test(ch);
}

export function charIsWord(ch: string): boolean {
  return ch === "_" || ALNUM.test(ch);
}

export function charIsPunctuation(ch: string): boolean {
  return PUNCT.test(ch);
}

export function isLowercase(ch: string): boolean {
  return LOWER.test(ch);
}

export function isUppercase(ch: string): boolean {
  return UPPER.test(ch);
}

export function categorizeChar(ch: string): CharCategory {
  if (charIsLineEnding(ch)) return "eol";
  if (isWhitespace(ch)) return "whitespace";
  if (charIsWord(ch)) return "word";
  if (charIsPunctuation(ch)) return "punctuation";
  return "unknown";
}

export function charAt(doc: Text, pos: number): string | null {
  if (pos < 0 || pos >= doc.length) return null;
  const s = doc.sliceString(pos, Math.min(doc.length, pos + 2));
  const cp = s.codePointAt(0)!;
  return String.fromCodePoint(cp);
}

export function charBefore(doc: Text, pos: number): string | null {
  if (pos <= 0 || pos > doc.length) return null;
  const s = doc.sliceString(Math.max(0, pos - 2), pos);
  if (s.length === 2) {
    const hi = s.charCodeAt(0);
    const lo = s.charCodeAt(1);
    if (hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff) return s;
  }
  return s.slice(-1);
}

export function nextCharPos(doc: Text, pos: number): number {
  const ch = charAt(doc, pos);
  return ch === null ? pos : pos + ch.length;
}

export function prevCharPos(doc: Text, pos: number): number {
  const ch = charBefore(doc, pos);
  return ch === null ? pos : pos - ch.length;
}

export class CharCursor {
  constructor(
    readonly doc: Text,
    public pos: number,
  ) {}
  next(): string | null {
    const ch = charAt(this.doc, this.pos);
    if (ch !== null) this.pos += ch.length;
    return ch;
  }
  prev(): string | null {
    const ch = charBefore(this.doc, this.pos);
    if (ch !== null) this.pos -= ch.length;
    return ch;
  }
}

export function lineIndex(doc: Text, pos: number): number {
  return doc.lineAt(pos).number - 1;
}

export function lineCount(doc: Text): number {
  return doc.lines;
}

export function lineStart(doc: Text, idx: number): number {
  if (idx >= doc.lines) return doc.length;
  return doc.line(idx + 1).from;
}

export function lineEnd(doc: Text, idx: number): number {
  return doc.line(Math.min(idx, doc.lines - 1) + 1).to;
}

export function lineEndInclusive(doc: Text, idx: number): number {
  if (idx >= doc.lines - 1) return doc.length;
  return doc.line(idx + 2).from;
}

export function lineIsEmpty(doc: Text, idx: number): boolean {
  if (idx >= doc.lines) return true;
  const line = doc.line(idx + 1);
  if (idx === doc.lines - 1) return line.length === 0;
  return line.length === 0;
}

export function lineText(doc: Text, idx: number): string {
  return doc.line(idx + 1).text;
}

export function lineWithEnding(doc: Text, idx: number): string {
  const line = doc.line(idx + 1);
  return idx < doc.lines - 1 ? line.text + "\n" : line.text;
}

export function charCount(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}
