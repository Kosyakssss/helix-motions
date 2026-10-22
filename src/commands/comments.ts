import type { Text } from "@codemirror/state";
import type { Context } from "../core/editor";
import { Range, Selection } from "../selection";
import { isWhitespace, lineIndex, lineWithEnding } from "../core/text";
import { apply, changeSetOf, docOf, exitSelectMode, lineRange, lineToChar, selOf, type Change } from "./util";

export interface BlockToken {
  start: string;
  end: string;
}

export interface CommentTokens {
  line: string[] | null;
  block: BlockToken[] | null;
}

const DEFAULT_LINE = "#";
const DEFAULT_BLOCK: BlockToken = { start: "/*", end: "*/" };

function firstNonWs(s: string): number | null {
  let off = 0;
  for (const ch of s) {
    if (!isWhitespace(ch)) return off;
    off += ch.length;
  }
  return null;
}

function lastNonWs(s: string): number | null {
  const chars = [...s];
  let off = s.length;
  for (let i = chars.length - 1; i >= 0; i--) {
    off -= chars[i]!.length;
    if (!isWhitespace(chars[i]!)) return off;
  }
  return null;
}

export function getCommentToken(doc: Text, tokens: string[], line: number): string | null {
  const text = lineWithEnding(doc, line);
  const start = firstNonWs(text);
  if (start === null) return null;
  let best: string | null = null;
  for (const t of tokens) if (text.slice(start).startsWith(t) && (best === null || t.length > best.length)) best = t;
  return best;
}

export function toggleLineComments(doc: Text, sel: Selection, token: string | null): Change[] {
  const tok = token ?? DEFAULT_LINE;
  const comment = `${tok} `;
  const lines: number[] = [];
  let minNext = 0;
  for (const range of sel.ranges) {
    const [s, e] = lineRange(doc, range);
    const start = Math.min(Math.max(s, minNext), doc.lines);
    const end = Math.min(e + 1, doc.lines);
    for (let l = start; l < end; l++) lines.push(l);
    minNext = end;
  }
  let commented = true;
  const toChange: number[] = [];
  let min = Number.MAX_SAFE_INTEGER;
  let margin = 1;
  for (const line of lines) {
    const text = lineWithEnding(doc, line);
    const pos = firstNonWs(text);
    if (pos === null) continue;
    min = Math.min(min, pos);
    if (text.slice(pos, Math.min(pos + tok.length, text.length)) !== tok) commented = false;
    if (text[pos + tok.length] !== " ") margin = 0;
    toChange.push(line);
  }
  return toChange.map((line) => {
    const pos = lineToChar(doc, line) + min;
    return commented ? [pos, pos + tok.length + margin, null] : [pos, pos, comment];
  });
}

type CommentChange =
  | { kind: "commented"; range: Range; startPos: number; endPos: number; startMargin: boolean; endMargin: boolean; startToken: string; endToken: string }
  | { kind: "uncommented"; range: Range; startPos: number; endPos: number; startToken: string; endToken: string }
  | { kind: "whitespace"; range: Range };

export function findBlockComments(tokens: BlockToken[], doc: Text, sel: Selection): [boolean, CommentChange[]] {
  let commented = true;
  let onlyWhitespace = true;
  const changes: CommentChange[] = [];
  const defaults = tokens[0] ?? DEFAULT_BLOCK;
  let startToken = defaults.start;
  let endToken = defaults.end;
  const sorted = [...tokens].sort((a, b) => (a.start.length === b.start.length ? b.end.length - a.end.length : b.start.length - a.start.length));
  for (const range of sel.ranges) {
    const slice = doc.sliceString(range.from(), range.to());
    const startPos = firstNonWs(slice);
    const endPos = lastNonWs(slice);
    if (startPos === null || endPos === null) {
      changes.push({ kind: "whitespace", range });
      continue;
    }
    let lineCommented = false;
    let afterStart = 0;
    let beforeEnd = 0;
    const len = endPos + 1 - startPos;
    for (const { start, end } of sorted) {
      afterStart = startPos + start.length;
      beforeEnd = Math.max(0, endPos - end.length);
      if (len >= start.length + end.length) {
        if (slice.slice(startPos, afterStart) === start && slice.slice(beforeEnd + 1, endPos + 1) === end) {
          startToken = start;
          endToken = end;
          lineCommented = true;
          break;
        }
      }
    }
    if (!lineCommented) {
      changes.push({ kind: "uncommented", range, startPos, endPos, startToken: defaults.start, endToken: defaults.end });
      commented = false;
    } else {
      changes.push({
        kind: "commented",
        range,
        startPos,
        endPos,
        startMargin: slice[afterStart] === " ",
        endMargin: afterStart !== beforeEnd && slice[beforeEnd] === " ",
        startToken,
        endToken,
      });
    }
    onlyWhitespace = false;
  }
  if (onlyWhitespace) commented = false;
  return [commented, changes];
}

export function createBlockCommentTransaction(sel: Selection, commented: boolean, comments: CommentChange[]): [Change[], Range[]] {
  const changes: Change[] = [];
  const ranges: Range[] = [];
  let offs = 0;
  for (const c of comments) {
    if (commented) {
      if (c.kind === "commented") {
        const from = c.range.from();
        changes.push([from + c.startPos, from + c.startPos + c.startToken.length + (c.startMargin ? 1 : 0), null]);
        changes.push([from + c.endPos - c.endToken.length - (c.endMargin ? 1 : 0) + 1, from + c.endPos + 1, null]);
      }
    } else if (c.kind === "uncommented") {
      const from = c.range.from();
      changes.push([from + c.startPos, from + c.startPos, `${c.startToken} `]);
      changes.push([from + c.endPos + 1, from + c.endPos + 1, ` ${c.endToken}`]);
      const offset = c.startToken.length + c.endToken.length + 2;
      ranges.push(new Range(from + offs, from + offs + c.endPos + 1 + offset).withDirection(c.range.direction()));
      offs += offset;
    } else {
      ranges.push(new Range(c.range.from() + offs, c.range.to() + offs));
    }
  }
  void sel;
  return [changes, ranges];
}

export function splitLinesOfSelection(doc: Text, sel: Selection): Selection {
  const ranges: Range[] = [];
  for (const range of sel.ranges) {
    const [ls, le] = lineRange(doc, range);
    for (let l = ls; l <= le; l++) {
      const start = lineToChar(doc, l);
      const end = lineToChar(doc, l + 1);
      ranges.push(new Range(start, end));
    }
  }
  return new Selection(ranges, 0);
}

export function runComments(cx: Context, kind: "toggle" | "line" | "block"): void {
  const doc = docOf(cx);
  const sel = selOf(cx);
  const tokens = cx.editor.commentTokens ? cx.editor.commentTokens(cx.host, sel.primary().cursor(doc)) : { line: null, block: null };
  const cursorLine = lineIndex(doc, sel.primary().cursor(doc));
  const lineToken = tokens.line ? (getCommentToken(doc, tokens.line, cursorLine) ?? tokens.line[0] ?? null) : null;
  const blockTokens = tokens.block;
  let changes: Change[];
  let ranges: Range[] | null = null;
  const blockToggle = (s: Selection, bt: BlockToken[]) => {
    const [commented, cc] = findBlockComments(bt, doc, s);
    const [ch, rs] = createBlockCommentTransaction(s, commented, cc);
    return { ch, rs: commented ? null : rs };
  };
  if (kind === "toggle") {
    if (lineToken !== null && blockTokens === null) {
      changes = toggleLineComments(doc, sel, lineToken);
    } else {
      const split = splitLinesOfSelection(doc, sel);
      const bt = blockTokens ?? [DEFAULT_BLOCK];
      const [lineCommented, lineChanges] = findBlockComments(bt, doc, split);
      if (lineCommented) {
        changes = createBlockCommentTransaction(split, true, lineChanges)[0];
      } else {
        const [blockCommented, blockChanges] = findBlockComments(bt, doc, sel);
        if (blockCommented) changes = createBlockCommentTransaction(sel, true, blockChanges)[0];
        else if (lineToken === null && blockTokens !== null) changes = createBlockCommentTransaction(split, false, lineChanges)[0];
        else changes = toggleLineComments(doc, sel, lineToken);
      }
    }
  } else if (kind === "line") {
    if (lineToken === null && blockTokens !== null) {
      const r = blockToggle(splitLinesOfSelection(doc, sel), blockTokens);
      changes = r.ch;
      ranges = r.rs;
    } else {
      changes = toggleLineComments(doc, sel, lineToken);
    }
  } else if (lineToken !== null && blockTokens === null) {
    changes = toggleLineComments(doc, sel, lineToken);
  } else {
    const r = blockToggle(sel, blockTokens ?? [DEFAULT_BLOCK]);
    changes = r.ch;
    ranges = r.rs;
  }
  apply(cx, changeSetOf(doc, changes), ranges ? new Selection(ranges, sel.primaryIndex) : null);
  exitSelectMode(cx);
}
