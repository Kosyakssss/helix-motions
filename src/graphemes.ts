import type { Text } from "@codemirror/state";
import { GRAPHEME_CATEGORIES, INCB_EXTEND, INCB_LINKERS } from "./core/grapheme-table";

const enum Cat {
  Any,
  CR,
  Control,
  Extend,
  ExtendedPictographic,
  InCBConsonant,
  L,
  LF,
  LV,
  LVT,
  Prepend,
  RegionalIndicator,
  SpacingMark,
  T,
  V,
  ZWJ,
}

const LINKERS = new Set(INCB_LINKERS);

function lookup(table: number[], stride: number, c: number): number {
  let lo = 0;
  let hi = table.length / stride;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (table[mid * stride + 1]! < c) lo = mid + 1;
    else hi = mid;
  }
  return lo < table.length / stride && table[lo * stride]! <= c ? lo : -1;
}

function category(c: number): Cat {
  const i = lookup(GRAPHEME_CATEGORIES, 3, c);
  return i < 0 ? Cat.Any : GRAPHEME_CATEGORIES[i * 3 + 2]!;
}

function isIncbExtend(c: number): boolean {
  return lookup(INCB_EXTEND, 2, c) >= 0;
}

function codePointBefore(s: string, i: number): number {
  const low = s.charCodeAt(i - 1);
  if (low >= 0xdc00 && low <= 0xdfff && i >= 2) {
    const high = s.charCodeAt(i - 2);
    if (high >= 0xd800 && high <= 0xdbff) return s.codePointAt(i - 2)!;
  }
  return low;
}

function unitsBefore(s: string, i: number): number {
  return codePointBefore(s, i) > 0xffff ? 2 : 1;
}

function isBoundaryAt(s: string, i: number): boolean {
  if (i <= 0 || i >= s.length) return true;
  const before = category(codePointBefore(s, i));
  const after = category(s.codePointAt(i)!);
  if (before === Cat.CR && after === Cat.LF) return false;
  if (before === Cat.Control || before === Cat.CR || before === Cat.LF) return true;
  if (after === Cat.Control || after === Cat.CR || after === Cat.LF) return true;
  if (before === Cat.L && (after === Cat.L || after === Cat.V || after === Cat.LV || after === Cat.LVT)) return false;
  if ((before === Cat.LV || before === Cat.V) && (after === Cat.V || after === Cat.T)) return false;
  if ((before === Cat.LVT || before === Cat.T) && after === Cat.T) return false;
  if (after === Cat.Extend || after === Cat.ZWJ) return false;
  if (after === Cat.SpacingMark) return false;
  if (before === Cat.Prepend) return false;
  if (after === Cat.InCBConsonant) return incbBreak(s, i);
  if (before === Cat.ZWJ && after === Cat.ExtendedPictographic) return emojiBreak(s, i);
  if (before === Cat.RegionalIndicator && after === Cat.RegionalIndicator) return regionalBreak(s, i);
  return true;
}

function incbBreak(s: string, i: number): boolean {
  let linkers = 0;
  for (let j = i; j > 0; j -= unitsBefore(s, j)) {
    const c = codePointBefore(s, j);
    if (LINKERS.has(c)) linkers++;
    else if (!isIncbExtend(c)) return !(linkers > 0 && category(c) === Cat.InCBConsonant);
  }
  return true;
}

function emojiBreak(s: string, i: number): boolean {
  let j = i - unitsBefore(s, i);
  while (j > 0) {
    const cat = category(codePointBefore(s, j));
    if (cat === Cat.ExtendedPictographic) return false;
    if (cat !== Cat.Extend) return true;
    j -= unitsBefore(s, j);
  }
  return true;
}

function regionalBreak(s: string, i: number): boolean {
  let count = 0;
  for (let j = i; j > 0 && category(codePointBefore(s, j)) === Cat.RegionalIndicator; j -= unitsBefore(s, j)) count++;
  return count % 2 === 0;
}

export function nextBoundaryIn(s: string, i: number): number {
  if (i >= s.length) return s.length;
  let j = i + (s.codePointAt(i)! > 0xffff ? 2 : 1);
  while (j < s.length && !isBoundaryAt(s, j)) j += s.codePointAt(j)! > 0xffff ? 2 : 1;
  return j;
}

export function prevBoundaryIn(s: string, i: number): number {
  if (i <= 0) return 0;
  let j = i - unitsBefore(s, i);
  while (j > 0 && !isBoundaryAt(s, j)) j -= unitsBefore(s, j);
  return j;
}

export function segmentGraphemes(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; ) {
    const j = nextBoundaryIn(s, i);
    out.push(s.slice(i, j));
    i = j;
  }
  return out;
}

export function nextGraphemeBoundary(doc: Text, pos: number): number {
  if (pos >= doc.length) return doc.length;
  const line = doc.lineAt(pos);
  if (pos >= line.to) return pos + 1;
  return line.from + nextBoundaryIn(line.text, pos - line.from);
}

export function prevGraphemeBoundary(doc: Text, pos: number): number {
  if (pos <= 0) return 0;
  if (pos > doc.length) return doc.length;
  const line = doc.lineAt(pos);
  if (pos <= line.from) return pos - 1;
  return line.from + prevBoundaryIn(line.text, pos - line.from);
}

export function nthNextGraphemeBoundary(doc: Text, pos: number, n: number): number {
  for (let i = 0; i < n; i++) pos = nextGraphemeBoundary(doc, pos);
  return pos;
}

export function nthPrevGraphemeBoundary(doc: Text, pos: number, n: number): number {
  for (let i = 0; i < n; i++) pos = prevGraphemeBoundary(doc, pos);
  return pos;
}

export function isGraphemeBoundary(doc: Text, pos: number): boolean {
  if (pos <= 0 || pos >= doc.length) return true;
  const line = doc.lineAt(pos);
  if (pos === line.from || pos === line.to) return true;
  const rel = pos - line.from;
  const c = line.text.charCodeAt(rel);
  if (c >= 0xdc00 && c <= 0xdfff) return false;
  return isBoundaryAt(line.text, rel);
}

export function ensureGraphemeBoundaryNext(doc: Text, pos: number): number {
  return isGraphemeBoundary(doc, pos) ? pos : nextGraphemeBoundary(doc, pos);
}

export function ensureGraphemeBoundaryPrev(doc: Text, pos: number): number {
  return isGraphemeBoundary(doc, pos) ? pos : prevGraphemeBoundary(doc, pos);
}
