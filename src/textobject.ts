import type { Text } from "@codemirror/state";
import { nextGraphemeBoundary, prevGraphemeBoundary } from "./graphemes";
import { Range } from "./selection";
import { findNthClosestPairsPos, findNthPairsPos } from "./surround";
import { categorizeChar, charAt, charBefore, charIsWhitespace, lineIndex, lineIsEmpty, lineStart } from "./core/text";

export type TextObject = "around" | "inside";

function findWordBoundary(doc: Text, pos: number, direction: "forward" | "backward", long: boolean): number {
  let prevCategory: string;
  if (direction === "forward") prevCategory = pos === 0 ? "whitespace" : categorizeChar(charBefore(doc, pos)!);
  else prevCategory = pos === doc.length ? "whitespace" : categorizeChar(charAt(doc, pos)!);
  for (;;) {
    const ch = direction === "forward" ? charAt(doc, pos) : charBefore(doc, pos);
    if (ch === null) break;
    const category = categorizeChar(ch);
    if (category === "eol" || category === "whitespace") return pos;
    if (!long && category !== prevCategory && pos !== 0 && pos !== doc.length) return pos;
    pos = direction === "forward" ? pos + ch.length : Math.max(0, pos - ch.length);
    prevCategory = category;
  }
  return pos;
}

export function textobjectWord(doc: Text, range: Range, textobject: TextObject, _count: number, long: boolean): Range {
  const pos = range.cursor(doc);
  const wordStart = findWordBoundary(doc, pos, "backward", long);
  const here = charAt(doc, pos);
  const cat = here === null ? null : categorizeChar(here);
  const wordEnd =
    here === null || cat === "whitespace" || cat === "eol"
      ? pos
      : findWordBoundary(doc, pos + here.length, "forward", long);
  if (wordStart === wordEnd) return new Range(wordStart, wordEnd);
  if (textobject === "inside") return new Range(wordStart, wordEnd);
  let right = wordEnd;
  for (;;) {
    const ch = charAt(doc, right);
    if (ch === null || !charIsWhitespace(ch)) break;
    right += ch.length;
  }
  if (right > wordEnd) return new Range(wordStart, right);
  let left = wordStart;
  for (;;) {
    const ch = charBefore(doc, left);
    if (ch === null || !charIsWhitespace(ch)) break;
    left -= ch.length;
  }
  return new Range(left, wordEnd);
}

export function textobjectParagraph(doc: Text, range: Range, textobject: TextObject, count: number): Range {
  const empty = (i: number) => lineIsEmpty(doc, i);
  let line = lineIndex(doc, range.cursor(doc));
  const prevLineEmpty = empty(Math.max(0, line - 1));
  const currLineEmpty = empty(line);
  const nextLineEmpty = line + 1 >= doc.lines || empty(line + 1);
  const lastChar = prevGraphemeBoundary(doc, lineStart(doc, line + 1)) === range.cursor(doc);
  const prevEmptyToLine = prevLineEmpty && !currLineEmpty;
  const currEmptyToLine = currLineEmpty && !nextLineEmpty;
  let lineBack = line;
  if (prevEmptyToLine || currEmptyToLine) lineBack += 1;
  const walkBack = () => {
    let i = lineBack - 1;
    while (i >= 0 && empty(i)) {
      i--;
      lineBack--;
    }
    while (i >= 0 && !empty(i)) {
      i--;
      lineBack--;
    }
  };
  if (!(currEmptyToLine && lastChar)) walkBack();
  if (currEmptyToLine && lastChar) line += 1;
  let idx = line;
  let countDone = 0;
  for (let k = 0; k < count; k++) {
    let done = false;
    while (idx < doc.lines && !empty(idx)) {
      idx++;
      line++;
      done = true;
    }
    while (idx < doc.lines && empty(idx)) {
      idx++;
      line++;
    }
    if (done) countDone++;
  }
  const lastParagraph = countDone !== count && idx >= doc.lines;
  if (lastParagraph) walkBack();
  if (textobject === "inside") {
    let i = line - 1;
    while (i >= 0 && empty(i)) {
      i--;
      line--;
    }
  }
  return new Range(lineStart(doc, lineBack), lineStart(doc, line));
}

function pairSurroundImpl(doc: Text, range: Range, textobject: TextObject, ch: string | null, count: number): Range {
  let pair: [number, number];
  try {
    pair = ch !== null ? findNthPairsPos(doc, ch, range, count) : findNthClosestPairsPos(doc, range, count);
  } catch {
    return range;
  }
  const [anchor, head] = pair;
  if (textobject === "inside") {
    return anchor < head
      ? new Range(nextGraphemeBoundary(doc, anchor), head)
      : new Range(anchor, nextGraphemeBoundary(doc, head));
  }
  return anchor < head
    ? new Range(anchor, nextGraphemeBoundary(doc, head))
    : new Range(nextGraphemeBoundary(doc, anchor), head);
}

export function textobjectPairSurround(doc: Text, range: Range, textobject: TextObject, ch: string, count: number): Range {
  return pairSurroundImpl(doc, range, textobject, ch, count);
}

export function textobjectPairSurroundClosest(doc: Text, range: Range, textobject: TextObject, count: number): Range {
  return pairSurroundImpl(doc, range, textobject, null, count);
}
