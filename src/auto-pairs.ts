import type { Text } from "@codemirror/state";
import { nextGraphemeBoundary, nthPrevGraphemeBoundary, prevGraphemeBoundary } from "./graphemes";
import { Range } from "./selection";
import { charAt, charBefore, isAlphanumeric, isWhitespace } from "./core/text";

export interface Pair {
  open: string;
  close: string;
}

export type AutoPairs = Map<string, Pair>;

export function makeAutoPairs(pairs: [string, string][]): AutoPairs {
  const map: AutoPairs = new Map();
  for (const [open, close] of pairs) {
    const pair = { open, close };
    map.set(open, pair);
    if (open !== close) map.set(close, pair);
  }
  return map;
}

export type Change = [number, number, string | null];

function same(pair: Pair): boolean {
  return pair.open === pair.close;
}

function nextIsNotAlpha(doc: Text, range: Range): boolean {
  const next = charAt(doc, range.cursor(doc));
  return next === null || !isAlphanumeric(next);
}

function prevIsNotAlpha(doc: Text, range: Range): boolean {
  const prev = charBefore(doc, range.cursor(doc));
  return prev === null || !isAlphanumeric(prev);
}

function shouldClose(pair: Pair, doc: Text, range: Range): boolean {
  let result = nextIsNotAlpha(doc, range);
  if (same(pair)) result = result && prevIsNotAlpha(doc, range);
  return result;
}

function isSingleGrapheme(doc: Text, range: Range): boolean {
  if (range.isEmpty()) return false;
  return nextGraphemeBoundary(doc, range.from()) === range.to();
}

export function hookInsert(doc: Text, range: Range, ch: string, pairs: AutoPairs): [Change, Range] | null {
  const pair = pairs.get(ch);
  if (pair) {
    if (same(pair)) return handleInsertSame(doc, range, pair);
    if (pair.open === ch) return handleInsertOpen(doc, range, pair);
    if (pair.close === ch) return handleInsertClose(doc, range, pair);
  } else if (isWhitespace(ch)) {
    return handleInsertWhitespace(doc, range, ch, pairs);
  }
  return null;
}

export function hookDelete(doc: Text, range: Range, pairs: AutoPairs): [[number, number], Range] | null {
  const cursor = range.cursor(doc);
  const cur = charAt(doc, cursor);
  const prev = charBefore(doc, cursor);
  if (cur === null || prev === null) return null;
  if (doc.length >= 4 && isWhitespace(prev) && isWhitespace(cur)) {
    const secondPrev = charAt(doc, nthPrevGraphemeBoundary(doc, cursor, 2));
    const secondNext = charAt(doc, nextGraphemeBoundary(doc, cursor));
    if (secondPrev === null || secondNext === null) return null;
    const pair = pairs.get(secondPrev);
    if (pair && pair.open === secondPrev && pair.close === secondNext) return handleDelete(doc, range);
  }
  const pair = pairs.get(cur);
  if (!pair) return null;
  if (pair.open !== prev || pair.close !== cur) return null;
  return handleDelete(doc, range);
}

export function handleDelete(doc: Text, range: Range): [[number, number], Range] {
  const cursor = range.cursor(doc);
  const endNext = nextGraphemeBoundary(doc, cursor);
  const endPrev = prevGraphemeBoundary(doc, cursor);
  const sizeDelete = endNext - endPrev;
  const nextHead = nextGraphemeBoundary(doc, range.head) - sizeDelete;
  const single = isSingleGrapheme(doc, range);
  let nextAnchor: number;
  if (range.direction() === "forward") nextAnchor = single ? range.anchor - (endNext - cursor) : range.anchor;
  else nextAnchor = single ? range.anchor - (cursor - endPrev) : range.anchor - sizeDelete;
  return [[endPrev, endNext], new Range(nextAnchor, nextHead)];
}

function handleInsertWhitespace(doc: Text, range: Range, ch: string, pairs: AutoPairs): [Change, Range] | null {
  const cursor = range.cursor(doc);
  const cur = charAt(doc, cursor);
  const prev = charBefore(doc, cursor);
  if (cur === null || prev === null) return null;
  const pair = pairs.get(cur);
  if (!pair || pair.open !== prev || pair.close !== cur) return null;
  if (pair.open !== "(" && pair.open !== "{") return null;
  return handleInsertSame(doc, range, { open: ch, close: ch });
}

function getNextRange(doc: Text, start: Range, lenInserted: number): Range {
  if (start.head === doc.length && start.anchor === doc.length) {
    return new Range(start.anchor + 1, start.head + 1);
  }
  const single = isSingleGrapheme(doc, start);
  if (lenInserted === 0) {
    const endAnchor = single ? nextGraphemeBoundary(doc, start.anchor) : start.anchor;
    return new Range(endAnchor, nextGraphemeBoundary(doc, start.head));
  }
  if (lenInserted === 1) {
    const endAnchor = single || start.direction() === "backward" ? start.anchor + 1 : start.anchor;
    return new Range(endAnchor, start.head + 1);
  }
  const endHead =
    start.head === 0 || start.direction() === "backward"
      ? start.head + 1
      : prevGraphemeBoundary(doc, start.head) + lenInserted;
  const len = start.to() - start.from();
  let endAnchor: number;
  if (len === 0) endAnchor = endHead;
  else if (len === 1 && start.direction() === "forward") endAnchor = endHead - 1;
  else if (len === 1) endAnchor = endHead + 1;
  else if (start.direction() === "forward") {
    endAnchor = single ? prevGraphemeBoundary(doc, start.head) + 1 : start.anchor;
  } else {
    endAnchor = single ? prevGraphemeBoundary(doc, start.anchor) + lenInserted : start.anchor + lenInserted;
  }
  return new Range(endAnchor, endHead);
}

function handleInsertOpen(doc: Text, range: Range, pair: Pair): [Change, Range] | null {
  const cursor = range.cursor(doc);
  const next = charAt(doc, cursor);
  if (next !== null && !shouldClose(pair, doc, range)) return null;
  const text = pair.open + pair.close;
  return [[cursor, cursor, text], getNextRange(doc, range, text.length)];
}

function handleInsertClose(doc: Text, range: Range, pair: Pair): [Change, Range] | null {
  const cursor = range.cursor(doc);
  if (charAt(doc, cursor) !== pair.close) return null;
  return [[cursor, cursor, null], getNextRange(doc, range, 0)];
}

function handleInsertSame(doc: Text, range: Range, pair: Pair): [Change, Range] | null {
  const cursor = range.cursor(doc);
  const next = charAt(doc, cursor);
  if (next === pair.open) return [[cursor, cursor, null], getNextRange(doc, range, 0)];
  if (!shouldClose(pair, doc, range)) return null;
  const text = pair.open + pair.close;
  return [[cursor, cursor, text], getNextRange(doc, range, text.length)];
}
