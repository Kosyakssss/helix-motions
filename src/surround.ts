import type { Text } from "@codemirror/state";
import { charAt, charBefore } from "./core/text";
import { findNthChar } from "./commands/motion";
import { findMatchingBracketPlaintext, getPair, isCloseBracket, isOpenBracket } from "./match-brackets";
import { Range, type Selection } from "./selection";
import { nextGraphemeBoundary } from "./graphemes";
import type { Syntax } from "./syntax/syntax";
import { findMatchingBracket, findMatchingBracketFuzzy } from "./syntax/object";

export class SurroundError extends Error {}

export const ERRORS = {
  pairNotFound: "Surround pair not found around all cursors",
  cursorOverlap: "Cursors overlap for a single surround pair range",
  rangeExceedsText: "Cursor range exceeds text length",
  cursorOnAmbiguousPair: "Cursor on ambiguous surround pair",
};

export function findNthClosestPairsPos(doc: Text, range: Range, skip: number, syntax: Syntax | null = null): [number, number] {
  return syntax ? findNthClosestPairsTs(syntax, doc, range, skip) : findNthClosestPairsPlain(doc, range, skip);
}

function findNthClosestPairsTs(syntax: Syntax, doc: Text, range: Range, skip: number): [number, number] {
  let opening = range.from();
  let closing = range.to();
  const seen = new Set<string>();
  while (skip > 0) {
    const state = `${closing}:${skip}`;
    if (seen.has(state)) throw new SurroundError(ERRORS.pairNotFound);
    seen.add(state);
    const fuzzy = findMatchingBracketFuzzy(syntax, doc, closing);
    if (fuzzy === null) throw new SurroundError(ERRORS.pairNotFound);
    closing = fuzzy;
    const matched = findMatchingBracket(syntax, doc, closing);
    if (matched === null) throw new SurroundError(ERRORS.pairNotFound);
    opening = matched;
    if (closing < opening) [opening, closing] = [closing, opening];
    if (range.from() < opening || closing < range.to() - 1) {
      closing = nextGraphemeBoundary(doc, closing);
    } else {
      skip--;
      if (skip !== 0) closing = nextGraphemeBoundary(doc, closing);
    }
  }
  return range.direction() === "forward" ? [opening, closing] : [closing, opening];
}

function findNthClosestPairsPlain(doc: Text, range: Range, skip: number): [number, number] {
  const stack: string[] = [];
  const pos = range.from();
  let p = pos;
  for (;;) {
    const ch = charAt(doc, p);
    if (ch === null) break;
    const closePos = pos === 0 ? p + ch.length : p;
    p += ch.length;
    if (isOpenBracket(ch)) {
      stack.push(ch);
      continue;
    }
    if (!isCloseBracket(ch)) continue;
    const [open, close] = getPair(ch);
    if (stack[stack.length - 1] === open) {
      stack.pop();
      continue;
    }
    const openPos = findNthOpenPair(doc, open, close, closePos, 1);
    if (openPos !== null && openPos <= pos + 1 && closePos >= Math.max(0, range.to() - 1)) {
      if (skip > 1) {
        skip--;
        continue;
      }
      return range.direction() === "forward" ? [openPos, closePos] : [closePos, openPos];
    }
  }
  throw new SurroundError(ERRORS.pairNotFound);
}

export function findNthPairsPos(doc: Text, ch: string, range: Range, n: number, syntax: Syntax | null = null): [number, number] {
  if (doc.length < 2) throw new SurroundError(ERRORS.pairNotFound);
  if (range.to() >= doc.length) throw new SurroundError(ERRORS.rangeExceedsText);
  const [open, close] = getPair(ch);
  const pos = range.cursor(doc);
  let o: number | null;
  let c: number | null;
  if (open === close) {
    if (charAt(doc, pos) === open) {
      const matching = syntax ? findMatchingBracketFuzzy(syntax, doc, pos) : findMatchingBracketPlaintext(doc, pos);
      if (matching === null) throw new SurroundError(ERRORS.cursorOnAmbiguousPair);
      if (matching > pos) {
        o = pos;
        c = matching;
      } else {
        o = matching;
        c = pos;
      }
    } else {
      o = findNthChar(n, doc, (x) => x === open, pos, "backward");
      c = findNthChar(n, doc, (x) => x === close, pos, "forward");
    }
  } else {
    o = findNthOpenPair(doc, open, close, pos, n);
    c = findNthClosePair(doc, open, close, pos, n);
  }
  if (o === null || c === null) throw new SurroundError(ERRORS.pairNotFound);
  return range.direction() === "forward" ? [o, c] : [c, o];
}

export function findNthOpenPair(doc: Text, open: string, close: string, pos: number, n: number): number | null {
  if (pos >= doc.length) return null;
  const here = charAt(doc, pos)!;
  let cursor = pos + here.length;
  const prev = () => {
    const ch = charBefore(doc, cursor);
    if (ch !== null) cursor -= ch.length;
    return ch;
  };
  const first = prev();
  if (first === null) return null;
  if (first === open) return pos;
  for (let i = 0; i < n; i++) {
    let stepOver = 0;
    for (;;) {
      const c = prev();
      if (c === null) return null;
      pos = cursor;
      if (c === close) stepOver++;
      else if (c === open) {
        if (stepOver === 0) break;
        stepOver = Math.max(0, stepOver - 1);
      }
    }
  }
  return pos;
}

export function findNthClosePair(doc: Text, open: string, close: string, pos: number, n: number): number | null {
  if (pos >= doc.length) return null;
  let cursor = pos;
  const next = () => {
    const ch = charAt(doc, cursor);
    if (ch !== null) cursor += ch.length;
    return ch;
  };
  const first = next();
  if (first === null) return null;
  if (first === close) return pos;
  for (let i = 0; i < n; i++) {
    let stepOver = 0;
    for (;;) {
      const at = cursor;
      const c = next();
      if (c === null) return null;
      pos = at;
      if (c === open) stepOver++;
      else if (c === close) {
        if (stepOver === 0) break;
        stepOver = Math.max(0, stepOver - 1);
      }
    }
  }
  return pos;
}

export function getSurroundPos(
  doc: Text,
  selection: Selection,
  ch: string | null,
  skip: number,
  syntax: Syntax | null = null,
): number[] {
  const changePos: number[] = [];
  for (const range of selection.ranges) {
    const raw = ch !== null ? findNthPairsPos(doc, ch, range, skip, syntax) : findNthClosestPairsPos(doc, range, skip, syntax);
    const r = new Range(raw[0], raw[1]);
    const openPos = r.from();
    const closePos = r.to();
    if (changePos.includes(openPos) || changePos.includes(closePos)) {
      throw new SurroundError(ERRORS.cursorOverlap);
    }
    changePos.push(Math.min(openPos, closePos), Math.max(openPos, closePos));
  }
  return changePos;
}
