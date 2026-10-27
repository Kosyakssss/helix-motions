import { EditorSelection, type Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  nextGraphemeBoundary,
  nthNextGraphemeBoundary,
  nthPrevGraphemeBoundary,
  prevGraphemeBoundary,
} from "./graphemes";
import { Range, type Direction } from "./selection";
import { EMOJI_PRESENTATION, WIDTH_RANGES } from "./core/width-table";
import {
  CharCursor,
  categorizeChar,
  charIsLineEnding,
  isLowercase,
  isUppercase,
  isWhitespace,
  lineIndex,
  lineIsEmpty,
  lineStart,
} from "./core/text";

export type Movement = "move" | "extend";

export function moveHorizontally(doc: Text, range: Range, dir: Direction, count: number, behaviour: Movement): Range {
  const pos = range.cursor(doc);
  const newPos =
    dir === "forward" ? nthNextGraphemeBoundary(doc, pos, count) : nthPrevGraphemeBoundary(doc, pos, count);
  return range.putCursor(doc, newPos, behaviour === "extend");
}

function charWidth(cp: number): number {
  let lo = 0;
  let hi = WIDTH_RANGES.length / 3 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const start = WIDTH_RANGES[mid * 3]!;
    const end = WIDTH_RANGES[mid * 3 + 1]!;
    if (cp < start) hi = mid - 1;
    else if (cp > end) lo = mid + 1;
    else return WIDTH_RANGES[mid * 3 + 2]!;
  }
  return 1;
}

export function graphemeWidth(g: string): number {
  if (g.charCodeAt(0) <= 127) return 1;
  const cps = [...g].map((c) => c.codePointAt(0)!);
  let w = 0;
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i]!;
    if (cps[i + 1] === 0xfe0f && EMOJI_PRESENTATION.has(cp)) {
      w += 2;
      i++;
      continue;
    }
    w += charWidth(cp);
  }
  return Math.max(1, w);
}

export function tabWidthAt(visualX: number, tabWidth: number): number {
  return tabWidth - (visualX % tabWidth);
}


function widthOf(g: string, col: number, tabWidth: number): number {
  if (g === "\t") return tabWidthAt(col, tabWidth);
  if (g === "\n" || g === "\r") return 1;
  return graphemeWidth(g);
}

export function visualColumn(doc: Text, lineFrom: number, pos: number, tabWidth: number): number {
  let col = 0;
  let p = lineFrom;
  while (p < pos) {
    const next = nextGraphemeBoundary(doc, p);
    const g = doc.sliceString(p, next);
    if (next > pos) break;
    col += widthOf(g, col, tabWidth);
    p = next;
  }
  return col;
}

function charIdxAtColumn(doc: Text, from: number, to: number, column: number, tabWidth: number): number {
  let col = 0;
  let p = from;
  while (p < to) {
    const next = nextGraphemeBoundary(doc, p);
    const g = doc.sliceString(p, next);
    const w = widthOf(g, col, tabWidth);
    if (col + w > column) return p;
    col += w;
    p = next;
  }
  return to;
}

export function moveVertically(
  doc: Text,
  range: Range,
  dir: Direction,
  count: number,
  behaviour: Movement,
  tabWidth: number,
): Range {
  const pos = range.cursor(doc);
  const lineIdx = lineIndex(doc, pos);
  const start = lineStart(doc, lineIdx);
  const col = visualColumn(doc, start, pos, tabWidth);
  let [newRow, newCol] = range.oldVisual ?? [0, col];
  newRow = Math.max(newRow, 0);
  let newLine = dir === "forward" ? lineIdx + count : Math.max(0, lineIdx - count);
  let end: number;
  if (newLine >= doc.lines - 1) {
    newLine = doc.lines - 1;
    end = doc.length;
  } else {
    end = prevGraphemeBoundary(doc, lineStart(doc, newLine + 1));
  }
  const newStart = lineStart(doc, newLine);
  const newPos = charIdxAtColumn(doc, newStart, end, newCol, tabWidth);
  if (behaviour === "extend" && newLine === doc.lines - 1 && doc.line(newLine + 1).length === 0) {
    return range;
  }
  return range.putCursor(doc, newPos, behaviour === "extend").withOldVisual([newRow, newCol]);
}

export function moveVisualVertically(
  view: EditorView,
  range: Range,
  dir: Direction,
  count: number,
  behaviour: Movement,
): Range {
  const doc = view.state.doc;
  let pos = range.cursor(doc);
  let goal = range.goalColumn;
  for (let i = 0; i < count; i++) {
    const start = EditorSelection.cursor(pos, 1, undefined, goal);
    const moved = view.moveVertically(start, dir === "forward");
    if (sameVisualRow(view, pos, moved.head)) break;
    pos = moved.head;
    goal = moved.goalColumn;
  }
  if (pos === range.cursor(doc)) return range;
  const line = doc.lineAt(pos);
  if (behaviour === "extend" && line.number === doc.lines && line.length === 0) return range;
  return range.putCursor(doc, pos, behaviour === "extend").withGoal(goal);
}

export interface Aim {
  range: Range;
  offset: number | null;
  span: readonly [number, number] | null;
}

export function aimAt(view: EditorView, range: Range, behaviour: Movement): Aim {
  const goal = range.goalColumn;
  const doc = view.state.doc;
  const pos = range.cursor(doc);
  const coords = view.coordsAtPos(pos, 1);
  const plain = (r: Range): Aim => ({ range: r, offset: visualRowOffset(view, r.cursor(doc)), span: null });
  if (goal === undefined || !coords) return plain(skipHidden(view, range, behaviour));
  const x = view.contentDOM.getBoundingClientRect().left + goal;
  const hit = view.dom.ownerDocument.elementFromPoint(x, (coords.top + coords.bottom) / 2);
  const line = hit?.closest(".cm-line");
  let widget = hit?.closest('[contenteditable="false"]');
  if (!line || !widget || !line.contains(widget) || !view.contentDOM.contains(line)) return plain(skipHidden(view, range, behaviour));
  while (widget.parentElement && widget.parentElement !== line && widget.parentElement.closest('[contenteditable="false"]')) {
    widget = widget.parentElement.closest('[contenteditable="false"]')!;
  }
  const parent = widget.parentNode!;
  const index = Array.prototype.indexOf.call(parent.childNodes, widget);
  let from = view.posAtDOM(parent, index);
  const to = view.posAtDOM(parent, index + 1);
  const docLine = doc.lineAt(pos);
  if (to <= from || from < docLine.from || from > docLine.to) return plain(range);
  while (from > docLine.from && zeroWidth(view, from - 1)) from--;
  const aimed = from === pos ? range : range.putCursor(doc, from, behaviour === "extend").withGoal(goal);
  return { range: aimed, offset: visualRowOffset(view, from), span: [from, to] };
}

function zeroWidth(view: EditorView, pos: number): boolean {
  const a = view.coordsAtPos(pos, 1);
  const b = view.coordsAtPos(pos + 1, -1);
  return !!a && !!b && Math.abs(b.left - a.left) < 0.5 && Math.abs(b.top - a.top) < 1;
}

function skipHidden(view: EditorView, range: Range, behaviour: Movement): Range {
  const doc = view.state.doc;
  const start = range.cursor(doc);
  const end = doc.lineAt(start).to;
  let pos = start;
  while (pos < end && zeroWidth(view, pos)) pos++;
  if (pos === start || pos === end) return range;
  return range.putCursor(doc, pos, behaviour === "extend").withGoal(range.goalColumn);
}

export function visualRowOffset(view: EditorView, pos: number): number | null {
  const coords = view.coordsAtPos(pos, 1);
  return coords ? coords.top - view.documentTop - view.lineBlockAt(pos).top : null;
}

export function restoreVisualRows(
  view: EditorView,
  ranges: readonly Range[],
  aims: readonly Aim[],
  behaviour: Movement,
  apply: (ranges: Range[]) => void,
): void {
  const doc = view.state.doc;
  queueMicrotask(() => {
    if (view.state.doc !== doc) return;
    const fixed = ranges.map((r, i) => restoreVisualRow(view, r, aims[i], behaviour));
    if (fixed.some((r, i) => r !== ranges[i])) apply(fixed);
  });
}

function restoreVisualRow(view: EditorView, range: Range, aim: Aim | undefined, behaviour: Movement): Range {
  const doc = view.state.doc;
  const pos = range.cursor(doc);
  const now = visualRowOffset(view, pos);
  const coords = view.coordsAtPos(pos, 1);
  if (!aim || aim.offset === null || now === null || !coords) return range;
  const block = view.lineBlockAt(pos);
  const left = view.contentDOM.getBoundingClientRect().left;
  const x = left + (range.goalColumn ?? coords.left - left);
  const moved = Math.abs(now - aim.offset) >= (coords.bottom - coords.top) / 2;
  if (!moved && !aim.span) return range;
  const y = moved ? view.documentTop + block.top + aim.offset + view.defaultLineHeight / 2 : (coords.top + coords.bottom) / 2;
  let target = view.posAtCoords({ x, y }, false);
  if (!moved && aim.span) {
    const [from, to] = aim.span;
    if (pos < from || pos >= to) return range;
    target = Math.max(from, Math.min(to - 1, target));
  }
  if (target < block.from || target > block.to || target === pos) return range;
  return range.putCursor(doc, target, behaviour === "extend").withGoal(range.goalColumn);
}

function sameVisualRow(view: EditorView, a: number, b: number): boolean {
  if (a === b) return true;
  const ca = view.coordsAtPos(a, 1);
  const cb = view.coordsAtPos(b, 1);
  if (!ca || !cb) return false;
  return Math.abs(ca.top - cb.top) < 1;
}

export type WordMotionTarget =
  | "nextWordStart"
  | "nextWordEnd"
  | "prevWordStart"
  | "prevWordEnd"
  | "nextLongWordStart"
  | "nextLongWordEnd"
  | "prevLongWordStart"
  | "prevLongWordEnd"
  | "nextSubWordStart"
  | "nextSubWordEnd"
  | "prevSubWordStart"
  | "prevSubWordEnd";

function isPrevTarget(target: WordMotionTarget): boolean {
  return target.startsWith("prev");
}

export function wordMove(doc: Text, range: Range, count: number, target: WordMotionTarget): Range {
  const isPrev = isPrevTarget(target);
  if ((isPrev && range.head === 0) || (!isPrev && range.head === doc.length)) return range;
  let start: Range;
  if (isPrev) {
    start =
      range.anchor < range.head
        ? new Range(range.head, prevGraphemeBoundary(doc, range.head))
        : new Range(nextGraphemeBoundary(doc, range.head), range.head);
  } else {
    start =
      range.anchor < range.head
        ? new Range(prevGraphemeBoundary(doc, range.head), range.head)
        : new Range(range.head, nextGraphemeBoundary(doc, range.head));
  }
  let current = start;
  for (let i = 0; i < count; i++) {
    const next = rangeToTarget(doc, target, current);
    if (next.eq(current)) break;
    current = next;
  }
  return current;
}

export function rangeToTarget(doc: Text, target: WordMotionTarget, origin: Range): Range {
  const isPrev = isPrevTarget(target);
  const cursor = new CharCursor(doc, origin.head);
  const next = () => (isPrev ? cursor.prev() : cursor.next());
  const back = () => (isPrev ? cursor.next() : cursor.prev());
  const advance = (pos: number, ch: string) => (isPrev ? Math.max(0, pos - ch.length) : pos + ch.length);
  let anchor = origin.anchor;
  let head = origin.head;
  let prevCh = back();
  if (prevCh !== null) next();
  for (;;) {
    const ch = next();
    if (ch === null) break;
    if (charIsLineEnding(ch)) {
      prevCh = ch;
      head = advance(head, ch);
    } else {
      back();
      break;
    }
  }
  if (prevCh !== null && charIsLineEnding(prevCh)) anchor = head;
  const headStart = head;
  for (;;) {
    const nextCh = next();
    if (nextCh === null) break;
    if (prevCh === null || reachedTarget(target, prevCh, nextCh)) {
      if (head === headStart) anchor = head;
      else break;
    }
    prevCh = nextCh;
    head = advance(head, nextCh);
  }
  return new Range(anchor, head);
}

function isWordBoundary(a: string, b: string): boolean {
  return categorizeChar(a) !== categorizeChar(b);
}

function isLongWordBoundary(a: string, b: string): boolean {
  const ca = categorizeChar(a);
  const cb = categorizeChar(b);
  if ((ca === "word" && cb === "punctuation") || (ca === "punctuation" && cb === "word")) return false;
  return ca !== cb;
}

function isSubWordBoundary(a: string, b: string, dir: Direction): boolean {
  const ca = categorizeChar(a);
  const cb = categorizeChar(b);
  if (ca === "word" && cb === "word") {
    if ((a === "_") !== (b === "_")) return true;
    return dir === "forward" ? isLowercase(a) && isUppercase(b) : isUppercase(a) && isLowercase(b);
  }
  return ca !== cb;
}

function reachedTarget(target: WordMotionTarget, prev: string, next: string): boolean {
  switch (target) {
    case "nextWordStart":
    case "prevWordEnd":
      return isWordBoundary(prev, next) && (charIsLineEnding(next) || !isWhitespace(next));
    case "nextWordEnd":
    case "prevWordStart":
      return isWordBoundary(prev, next) && (!isWhitespace(prev) || charIsLineEnding(next));
    case "nextLongWordStart":
    case "prevLongWordEnd":
      return isLongWordBoundary(prev, next) && (charIsLineEnding(next) || !isWhitespace(next));
    case "nextLongWordEnd":
    case "prevLongWordStart":
      return isLongWordBoundary(prev, next) && (!isWhitespace(prev) || charIsLineEnding(next));
    case "nextSubWordStart":
      return (
        isSubWordBoundary(prev, next, "forward") &&
        (charIsLineEnding(next) || !(isWhitespace(next) || next === "_"))
      );
    case "prevSubWordEnd":
      return (
        isSubWordBoundary(prev, next, "backward") &&
        (charIsLineEnding(next) || !(isWhitespace(next) || next === "_"))
      );
    case "nextSubWordEnd":
      return (
        isSubWordBoundary(prev, next, "forward") &&
        (!(isWhitespace(prev) || prev === "_") || charIsLineEnding(next))
      );
    case "prevSubWordStart":
      return (
        isSubWordBoundary(prev, next, "backward") &&
        (!(isWhitespace(prev) || prev === "_") || charIsLineEnding(next))
      );
  }
}

export function cursorLine(doc: Text, range: Range): number {
  return lineIndex(doc, range.cursor(doc));
}

export function movePrevParagraph(doc: Text, range: Range, count: number, behaviour: Movement): Range {
  let line = cursorLine(doc, range);
  const firstChar = lineStart(doc, line) === range.cursor(doc);
  const prevLineEmpty = lineIsEmpty(doc, Math.max(0, line - 1));
  const currLineEmpty = lineIsEmpty(doc, line);
  const prevEmptyToLine = prevLineEmpty && !currLineEmpty;
  if (prevEmptyToLine && !firstChar) line += 1;
  let idx = line - 1;
  const peek = () => (idx >= 0 ? lineIsEmpty(doc, idx) : null);
  let lastLine = line;
  for (let i = 0; i < count; i++) {
    while (peek() === true) {
      idx--;
      line--;
    }
    while (peek() === false) {
      idx--;
      line--;
    }
    if (line === lastLine) break;
    lastLine = line;
  }
  const head = lineStart(doc, line);
  let anchor: number;
  if (behaviour === "move") {
    anchor = prevEmptyToLine && firstChar ? range.cursor(doc) : range.head;
  } else {
    anchor = range.putCursor(doc, head, true).anchor;
  }
  return new Range(anchor, head);
}

export function moveNextParagraph(doc: Text, range: Range, count: number, behaviour: Movement): Range {
  let line = cursorLine(doc, range);
  const lastChar = prevGraphemeBoundary(doc, lineStart(doc, line + 1)) === range.cursor(doc);
  const currLineEmpty = lineIsEmpty(doc, line);
  const nextLineEmpty = lineIsEmpty(doc, Math.min(Math.max(0, doc.lines - 1), line + 1));
  const currEmptyToLine = currLineEmpty && !nextLineEmpty;
  if (currEmptyToLine && lastChar) line += 1;
  let idx = line;
  const peek = () => (idx < doc.lines ? lineIsEmpty(doc, idx) : null);
  let lastLine = line;
  for (let i = 0; i < count; i++) {
    while (peek() === false) {
      idx++;
      line++;
    }
    while (peek() === true) {
      idx++;
      line++;
    }
    if (line === lastLine) break;
    lastLine = line;
  }
  const head = lineStart(doc, line);
  let anchor: number;
  if (behaviour === "move") {
    anchor = currEmptyToLine && lastChar ? range.head : range.cursor(doc);
  } else {
    anchor = range.putCursor(doc, head, true).anchor;
  }
  return new Range(anchor, head);
}

