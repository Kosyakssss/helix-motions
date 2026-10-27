import type { Text, TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Context } from "../core/editor";
import {
  nextGraphemeBoundary,
  nthNextGraphemeBoundary,
  prevGraphemeBoundary,
} from "../graphemes";
import {
  moveHorizontally,
  moveNextParagraph,
  movePrevParagraph,
  moveVertically,
  moveVisualVertically,
  aimAt,
  restoreVisualRows,
  type Aim,
  wordMove,
  type Movement,
  type WordMotionTarget,
} from "../movement";
import { Range, Selection, type Direction } from "../selection";
import { charAt, lineIndex, nextCharPos, prevCharPos } from "../core/text";
import { docOf, firstNonWhitespaceChar, lineEndCharIndex, lineToChar, modeOf, selOf, setSel } from "./util";
import { pushJump } from "./jumps";

export type CommandFn = (cx: Context, arg?: string) => void;

export function applyMotion(cx: Context, motion: (cx: Context) => void): void {
  motion(cx);
  cx.editor.lastMotion = motion;
}

export function repeatLastMotion(cx: Context): void {
  const motion = cx.editor.lastMotion;
  if (!motion) return;
  const count = cx.count();
  for (let i = 0; i < count; i++) motion(cx);
}

function moveImpl(
  cx: Context,
  f: (doc: Text, range: Range, dir: Direction, count: number, behaviour: Movement) => Range,
  dir: Direction,
  behaviour: Movement,
): void {
  const count = cx.count();
  const doc = docOf(cx);
  setSel(cx, selOf(cx).transform((r) => f(doc, r, dir, count, behaviour)));
}

function logical(cx: Context) {
  return (doc: Text, range: Range, dir: Direction, count: number, behaviour: Movement) =>
    moveVertically(doc, range, dir, count, behaviour, cx.editor.config.tabWidth);
}

function moveVisual(cx: Context, dir: Direction, behaviour: Movement): void {
  const view = cx.host.view;
  if (!view || !cx.editor.visualLines) return moveImpl(cx, logical(cx), dir, behaviour);
  const count = cx.count();
  moveVisualSelection(cx, view, behaviour, (r) => moveVisualVertically(view, r, dir, count, behaviour));
}

export function moveVisualSelection(
  cx: Context,
  view: EditorView,
  behaviour: Movement,
  move: (range: Range) => Range,
  extra: TransactionSpec = {},
): void {
  const aims: Aim[] = [];
  const next = selOf(cx).transform((r) => {
    const target = move(r);
    const aim = target === r ? { range: r, offset: null, span: null } : aimAt(view, target, behaviour);
    aims.push(aim);
    return aim.range;
  });
  setSel(cx, next, extra);
  const sel = selOf(cx);
  if (sel.ranges.length !== aims.length) return;
  restoreVisualRows(view, sel.ranges, aims, behaviour, (fixed) => {
    if (selOf(cx) === sel) setSel(cx, new Selection(fixed, sel.primaryIndex));
  });
}

export const motionCommands: Record<string, CommandFn> = {
  move_char_left: (cx) => moveImpl(cx, moveHorizontally, "backward", "move"),
  move_char_right: (cx) => moveImpl(cx, moveHorizontally, "forward", "move"),
  move_line_up: (cx) => moveImpl(cx, logical(cx), "backward", "move"),
  move_line_down: (cx) => moveImpl(cx, logical(cx), "forward", "move"),
  move_visual_line_up: (cx) => moveVisual(cx, "backward", "move"),
  move_visual_line_down: (cx) => moveVisual(cx, "forward", "move"),
  extend_char_left: (cx) => moveImpl(cx, moveHorizontally, "backward", "extend"),
  extend_char_right: (cx) => moveImpl(cx, moveHorizontally, "forward", "extend"),
  extend_line_up: (cx) => moveImpl(cx, logical(cx), "backward", "extend"),
  extend_line_down: (cx) => moveImpl(cx, logical(cx), "forward", "extend"),
  extend_visual_line_up: (cx) => moveVisual(cx, "backward", "extend"),
  extend_visual_line_down: (cx) => moveVisual(cx, "forward", "extend"),
  goto_line_end: (cx) => gotoLineEnd(cx, modeOf(cx) === "select" ? "extend" : "move"),
  extend_to_line_end: (cx) => gotoLineEnd(cx, "extend"),
  goto_line_end_newline: (cx) => gotoLineEndNewline(cx, modeOf(cx) === "select" ? "extend" : "move"),
  extend_to_line_end_newline: (cx) => gotoLineEndNewline(cx, "extend"),
  goto_line_start: (cx) => gotoLineStart(cx, modeOf(cx) === "select" ? "extend" : "move"),
  extend_to_line_start: (cx) => gotoLineStart(cx, "extend"),
  goto_first_nonwhitespace: (cx) => gotoFirstNonwhitespace(cx, modeOf(cx) === "select" ? "extend" : "move"),
  extend_to_first_nonwhitespace: (cx) => gotoFirstNonwhitespace(cx, "extend"),
  goto_prev_paragraph: (cx) => gotoPara(cx, movePrevParagraph),
  goto_next_paragraph: (cx) => gotoPara(cx, moveNextParagraph),
  goto_file_start: (cx) => gotoFileStart(cx, "move"),
  extend_to_file_start: (cx) => gotoFileStart(cx, "extend"),
  goto_file_end: (cx) => gotoFileEnd(cx, "move"),
  extend_to_file_end: (cx) => gotoFileEnd(cx, "extend"),
  goto_line: (cx) => gotoLine(cx, "move"),
  goto_last_line: (cx) => gotoLastLine(cx, "move"),
  extend_to_last_line: (cx) => gotoLastLine(cx, "extend"),
  goto_column: (cx) => gotoColumn(cx, "move"),
  extend_to_column: (cx) => gotoColumn(cx, "extend"),
  find_till_char: (cx) => findChar(cx, "forward", false, false),
  find_next_char: (cx) => findChar(cx, "forward", true, false),
  extend_till_char: (cx) => findChar(cx, "forward", false, true),
  extend_next_char: (cx) => findChar(cx, "forward", true, true),
  till_prev_char: (cx) => findChar(cx, "backward", false, false),
  find_prev_char: (cx) => findChar(cx, "backward", true, false),
  extend_till_prev_char: (cx) => findChar(cx, "backward", false, true),
  extend_prev_char: (cx) => findChar(cx, "backward", true, true),
  repeat_last_motion: repeatLastMotion,
};

const WORD_TARGETS: [string, WordMotionTarget][] = [
  ["next_word_start", "nextWordStart"],
  ["prev_word_start", "prevWordStart"],
  ["next_word_end", "nextWordEnd"],
  ["prev_word_end", "prevWordEnd"],
  ["next_long_word_start", "nextLongWordStart"],
  ["prev_long_word_start", "prevLongWordStart"],
  ["next_long_word_end", "nextLongWordEnd"],
  ["prev_long_word_end", "prevLongWordEnd"],
  ["next_sub_word_start", "nextSubWordStart"],
  ["prev_sub_word_start", "prevSubWordStart"],
  ["next_sub_word_end", "nextSubWordEnd"],
  ["prev_sub_word_end", "prevSubWordEnd"],
];

for (const [name, target] of WORD_TARGETS) {
  motionCommands[`move_${name}`] = (cx) => {
    const count = cx.count();
    const doc = docOf(cx);
    setSel(cx, selOf(cx).transform((r) => wordMove(doc, r, count, target)));
  };
  motionCommands[`extend_${name}`] = (cx) => {
    const count = cx.count();
    const doc = docOf(cx);
    setSel(
      cx,
      selOf(cx).transform((r) => {
        const word = wordMove(doc, r, count, target);
        return r.putCursor(doc, word.cursor(doc), true);
      }),
    );
  };
}

function gotoLineEnd(cx: Context, movement: Movement): void {
  const doc = docOf(cx);
  setSel(
    cx,
    selOf(cx).transform((r) => {
      const line = lineIndex(doc, r.cursor(doc));
      const start = lineToChar(doc, line);
      const pos = Math.max(prevGraphemeBoundary(doc, lineEndCharIndex(doc, line)), start);
      return r.putCursor(doc, pos, movement === "extend");
    }),
  );
}

function gotoLineEndNewline(cx: Context, movement: Movement): void {
  const doc = docOf(cx);
  setSel(
    cx,
    selOf(cx).transform((r) => {
      const line = lineIndex(doc, r.cursor(doc));
      return r.putCursor(doc, lineEndCharIndex(doc, line), movement === "extend");
    }),
  );
}

function gotoLineStart(cx: Context, movement: Movement): void {
  const doc = docOf(cx);
  setSel(
    cx,
    selOf(cx).transform((r) => {
      const line = lineIndex(doc, r.cursor(doc));
      return r.putCursor(doc, lineToChar(doc, line), movement === "extend");
    }),
  );
}

function gotoFirstNonwhitespace(cx: Context, movement: Movement): void {
  const doc = docOf(cx);
  setSel(
    cx,
    selOf(cx).transform((r) => {
      const line = lineIndex(doc, r.cursor(doc));
      const offset = firstNonWhitespaceChar(doc, line);
      if (offset === null) return r;
      return r.putCursor(doc, lineToChar(doc, line) + offset, movement === "extend");
    }),
  );
}

function gotoPara(cx: Context, f: (doc: Text, range: Range, count: number, behaviour: Movement) => Range): void {
  const count = cx.count();
  applyMotion(cx, (cx) => {
    const doc = docOf(cx);
    const behaviour: Movement = modeOf(cx) === "select" ? "extend" : "move";
    setSel(cx, selOf(cx).transform((r) => f(doc, r, count, behaviour)));
  });
}

function gotoFileStart(cx: Context, movement: Movement): void {
  if (cx.countRaw !== null) {
    gotoLine(cx, movement);
    return;
  }
  const doc = docOf(cx);
  const sel = selOf(cx).transform((r) => r.putCursor(doc, 0, movement === "extend"));
  pushJump(cx);
  setSel(cx, sel);
}

function gotoFileEnd(cx: Context, movement: Movement): void {
  const doc = docOf(cx);
  const sel = selOf(cx).transform((r) => r.putCursor(doc, doc.length, movement === "extend"));
  pushJump(cx);
  setSel(cx, sel);
}

export function gotoLine(cx: Context, movement: Movement): void {
  if (cx.countRaw === null) return;
  pushJump(cx);
  gotoLineWithoutJumplist(cx, cx.countRaw, movement);
}

export function gotoLineWithoutJumplist(cx: Context, count: number, movement: Movement): void {
  const doc = docOf(cx);
  const maxLine = doc.line(doc.lines).length === 0 ? Math.max(0, doc.lines - 2) : doc.lines - 1;
  const lineIdx = Math.min(count - 1, maxLine);
  const pos = lineToChar(doc, lineIdx);
  setSel(cx, selOf(cx).transform((r) => r.putCursor(doc, pos, movement === "extend")));
}

function gotoLastLine(cx: Context, movement: Movement): void {
  const doc = docOf(cx);
  const lineIdx = doc.line(doc.lines).length === 0 ? Math.max(0, doc.lines - 2) : doc.lines - 1;
  const pos = lineToChar(doc, lineIdx);
  const sel = selOf(cx).transform((r) => r.putCursor(doc, pos, movement === "extend"));
  pushJump(cx);
  setSel(cx, sel);
}

function gotoColumn(cx: Context, movement: Movement): void {
  const count = cx.count();
  const doc = docOf(cx);
  const sel = selOf(cx).transform((r) => {
    const line = lineIndex(doc, r.cursor(doc));
    const start = lineToChar(doc, line);
    const end = lineEndCharIndex(doc, line);
    const pos = Math.min(nthNextGraphemeBoundary(doc, start, count - 1), end);
    return r.putCursor(doc, pos, movement === "extend");
  });
  pushJump(cx);
  setSel(cx, sel);
}

export function findNthChar(
  n: number,
  doc: Text,
  matches: (ch: string) => boolean,
  pos: number,
  dir: Direction,
): number | null {
  if (n === 0 || pos < 0 || pos > doc.length) return null;
  if (dir === "forward") {
    for (;;) {
      const ch = charAt(doc, pos);
      if (ch === null) return null;
      if (matches(ch)) {
        n--;
        if (n === 0) return pos;
      }
      pos += ch.length;
    }
  }
  for (;;) {
    if (pos <= 0) return null;
    const prev = prevCharPos(doc, pos);
    const ch = doc.sliceString(prev, pos);
    pos = prev;
    if (matches(ch)) {
      n--;
      if (n === 0) return pos;
    }
  }
}

function findCharLineEndingMotion(cx: Context, count: number, dir: Direction, inclusive: boolean, extend: boolean): void {
  const doc = docOf(cx);
  const sel = selOf(cx).transform((range) => {
    const cursorAnchor = range.cursor(doc);
    const cursorHead = nextGraphemeBoundary(doc, cursorAnchor);
    const cursorLine = lineIndex(doc, cursorAnchor);
    let pos: number;
    if (dir === "forward") {
      const lineEnd = lineEndCharIndex(doc, cursorLine);
      const onEdge = inclusive ? lineEnd === cursorAnchor : lineEnd === cursorHead || lineEnd === cursorAnchor;
      const line = cursorLine + count - 1 + (onEdge ? 1 : 0);
      if (line >= doc.lines - 1) return range;
      pos = lineEndCharIndex(doc, line) - (inclusive ? 0 : 1);
    } else if (inclusive) {
      const line = cursorLine - count;
      if (line < 0) return range;
      pos = lineEndCharIndex(doc, line);
    } else {
      const onEdge = lineToChar(doc, cursorLine) === cursorAnchor;
      const line = cursorLine - count + 1 - (onEdge ? 1 : 0);
      if (line <= 0) return range;
      pos = lineToChar(doc, line);
    }
    return extend ? range.putCursor(doc, pos, true) : Range.point(range.cursor(doc)).putCursor(doc, pos, true);
  });
  setSel(cx, sel);
}

export function findChar(cx: Context, dir: Direction, inclusive: boolean, extend: boolean): void {
  const count = cx.count();
  cx.onNextKey((cx, key) => {
    let motion: (cx: Context) => void;
    if (key === "ret") {
      motion = (cx) => findCharLineEndingMotion(cx, count, dir, inclusive, extend);
    } else {
      const ch = key === "tab" ? "\t" : keyCharOf(key);
      if (ch === null) return;
      motion = (cx) => {
        const doc = docOf(cx);
        setSel(
          cx,
          selOf(cx).transform((range) => {
            const cursorAnchor = range.cursor(doc);
            const cursorHead = nextGraphemeBoundary(doc, cursorAnchor);
            let start: number;
            if (inclusive) start = dir === "forward" ? cursorHead : cursorAnchor;
            else start = dir === "forward" ? nextCharPos(doc, cursorHead) : prevCharPos(doc, cursorAnchor);
            if (!inclusive && dir === "forward" && cursorHead >= doc.length) return range;
            let pos = findNthChar(count, doc, (c) => c === ch, start, dir);
            if (pos === null) return range;
            if (!inclusive) pos = dir === "forward" ? prevCharPos(doc, pos) : nextCharPos(doc, pos);
            return extend ? range.putCursor(doc, pos, true) : Range.point(range.cursor(doc)).putCursor(doc, pos, true);
          }),
        );
      };
    }
    applyMotion(cx, motion);
  });
}

export function keyCharOf(key: string): string | null {
  if (key === "space") return " ";
  if (key === "minus") return "-";
  if (key === "lt") return "<";
  if (key === "gt") return ">";
  const parts = key.split("-");
  const code = parts[parts.length - 1]!;
  if (code === "" && key.endsWith("-")) return "-";
  return [...code].length === 1 ? code : null;
}
