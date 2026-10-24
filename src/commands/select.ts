import type { Text } from "@codemirror/state";
import { Context } from "../core/editor";
import { jumplistFor } from "./jumps";
import { ensureGraphemeBoundaryNext, ensureGraphemeBoundaryPrev, nextGraphemeBoundary, prevGraphemeBoundary } from "../graphemes";
import { graphemeWidth, visualColumn } from "../movement";
import { Range, Selection } from "../selection";
import {
  charAt,
  charBefore,
  charIsWord,
  isUppercase,
  isWhitespace,
  lineIndex,
  lineStart,
  nextCharPos,
} from "../core/text";
import { compilePattern, escapeRegex, type Pattern } from "../core/regex";
import { apply, changeSetOf, docOf, exitSelectMode, lineRange, lineToChar, modeOf, selOf, setSel } from "./util";
import type { CommandFn } from "./motion";

function extendLineImpl(cx: Context, extend: "above" | "below"): void {
  const count = cx.count();
  const doc = docOf(cx);
  setSel(
    cx,
    selOf(cx).transform((range) => {
      const [startLine, endLine] = lineRange(doc, range);
      const start = lineToChar(doc, startLine);
      const end = lineToChar(doc, Math.min(endLine + 1, doc.lines));
      let anchor: number;
      let head: number;
      if (range.from() === start && range.to() === end) {
        if (extend === "above") {
          anchor = end;
          head = lineToChar(doc, Math.max(0, startLine - count));
        } else {
          anchor = start;
          head = lineToChar(doc, Math.min(endLine + count + 1, doc.lines));
        }
      } else if (extend === "above") {
        anchor = end;
        head = lineToChar(doc, Math.max(0, startLine - (count - 1)));
      } else {
        anchor = start;
        head = lineToChar(doc, Math.min(endLine + count, doc.lines));
      }
      return new Range(anchor, head);
    }),
  );
}

function selectLineImpl(cx: Context, extend: "above" | "below"): void {
  let count = cx.count();
  const doc = docOf(cx);
  const add = (a: number, b: number) => Math.min(a + b, doc.lines);
  setSel(
    cx,
    selOf(cx).transform((range) => {
      const [startLine, endLine] = lineRange(doc, range);
      const start = lineToChar(doc, startLine);
      const end = lineToChar(doc, add(endLine, 1));
      const direction = range.direction();
      if (range.from() !== start || range.to() !== end) count = Math.max(0, count - 1);
      let anchorLine: number;
      let headLine: number;
      if (extend === "above" && direction === "forward") {
        anchorLine = startLine;
        headLine = Math.max(0, endLine - count);
      } else if (extend === "above") {
        anchorLine = endLine;
        headLine = Math.max(0, startLine - count);
      } else if (direction === "forward") {
        anchorLine = startLine;
        headLine = add(endLine, count);
      } else {
        anchorLine = endLine;
        headLine = add(startLine, count);
      }
      let anchor: number;
      let head: number;
      if (anchorLine < headLine) {
        anchor = lineToChar(doc, anchorLine);
        head = lineToChar(doc, add(headLine, 1));
      } else if (anchorLine === headLine) {
        if (extend === "above") {
          anchor = lineToChar(doc, add(anchorLine, 1));
          head = lineToChar(doc, headLine);
        } else {
          anchor = lineToChar(doc, headLine);
          head = lineToChar(doc, add(anchorLine, 1));
        }
      } else {
        anchor = lineToChar(doc, add(anchorLine, 1));
        head = lineToChar(doc, headLine);
      }
      return new Range(anchor, head);
    }),
  );
}

export function splitOnNewline(doc: Text, sel: Selection): Selection {
  const result: Range[] = [];
  for (const range of sel.ranges) {
    if (range.from() === range.to()) {
      result.push(range);
      continue;
    }
    const selEnd = range.to();
    let start = range.from();
    for (;;) {
      const line = doc.lineAt(start);
      if (line.to >= selEnd) break;
      result.push(new Range(start, line.to));
      start = line.to + 1;
    }
    if (start < selEnd) result.push(new Range(start, selEnd));
  }
  return new Selection(result, 0);
}

export function selectOnMatches(doc: Text, sel: Selection, re: Pattern): Selection | null {
  const result: Range[] = [];
  for (const range of sel.ranges) {
    for (const [start, end] of re.findAll(doc, range.from(), range.to())) {
      const r = new Range(start, end);
      if (!(r.anchor === range.to() && r.head === range.to())) result.push(r);
    }
  }
  return result.length > 0 ? new Selection(result, 0) : null;
}

export function splitOnMatches(doc: Text, sel: Selection, re: Pattern): Selection {
  const result: Range[] = [];
  for (const range of sel.ranges) {
    if (range.from() === range.to()) {
      result.push(range);
      continue;
    }
    const selEnd = range.to();
    let start = range.from();
    for (const [mStart, mEnd] of re.findAll(doc, range.from(), selEnd)) {
      result.push(new Range(start, mStart));
      start = mEnd;
    }
    if (start < selEnd) result.push(new Range(start, selEnd));
  }
  return new Selection(result, 0);
}

export function keepOrRemoveMatches(doc: Text, sel: Selection, re: Pattern, remove: boolean): Selection | null {
  const result = sel.ranges.filter((r) => re.isMatch(doc, r.from(), r.to()) !== remove);
  return result.length > 0 ? new Selection(result, 0) : null;
}

export function mergeRanges(sel: Selection): Selection {
  const first = sel.ranges[0]!;
  const last = sel.ranges[sel.ranges.length - 1]!;
  return new Selection([first.merge(last)], 0);
}

export function mergeConsecutiveRanges(sel: Selection): Selection {
  let primary = sel.primary();
  const ranges: Range[] = [];
  for (const range of sel.ranges) {
    const prev = ranges[ranges.length - 1];
    if (prev && prev.to() === range.from()) {
      const merged = range.merge(prev);
      if (prev === primary || range === primary) primary = merged;
      ranges[ranges.length - 1] = merged;
    } else {
      ranges.push(range);
    }
  }
  return new Selection(ranges, Math.max(0, ranges.indexOf(primary)));
}

function trimSelections(cx: Context): void {
  const doc = docOf(cx);
  const sel = selOf(cx);
  const ranges: Range[] = [];
  for (const range of sel.ranges) {
    const frag = doc.sliceString(range.from(), range.to());
    if (range.isEmpty() || [...frag].every((c) => isWhitespace(c))) continue;
    let start = range.from();
    let end = range.to();
    while (start < doc.length) {
      const ch = charAt(doc, start)!;
      if (!isWhitespace(ch)) break;
      start += ch.length;
    }
    while (end > 0) {
      const ch = charBefore(doc, end)!;
      if (!isWhitespace(ch)) break;
      end -= ch.length;
    }
    ranges.push(new Range(start, end).withDirection(range.direction()));
  }
  if (ranges.length > 0) {
    const primary = sel.primary();
    let idx = ranges.findIndex((r) => r.overlaps(primary));
    if (idx < 0) idx = ranges.length - 1;
    setSel(cx, new Selection(ranges, idx));
  } else {
    collapseSelection(cx);
    keepPrimarySelection(cx);
  }
}

export function collapseSelection(cx: Context): void {
  const doc = docOf(cx);
  setSel(
    cx,
    selOf(cx).transform((r) => {
      const pos = r.cursor(doc);
      return new Range(pos, pos);
    }),
  );
}

export function keepPrimarySelection(cx: Context): void {
  const range = selOf(cx).primary();
  setSel(cx, Selection.single(range.anchor, range.head));
}

function visualCoords(doc: Text, pos: number, tabWidth: number): { row: number; col: number } {
  const row = lineIndex(doc, pos);
  return { row, col: visualColumn(doc, lineStart(doc, row), pos, tabWidth) };
}

function posAtVisualCoords(doc: Text, row: number, col: number, tabWidth: number): number {
  const r = Math.min(row, doc.lines - 1);
  const line = doc.line(r + 1);
  let p = line.from;
  let remaining = col;
  while (p < line.to) {
    const next = nextGraphemeBoundary(doc, p);
    const g = doc.sliceString(p, next);
    const w = g === "\t" ? tabWidth - ((col - remaining) % tabWidth) : graphemeWidth(g);
    if (w > remaining) break;
    remaining -= w;
    p = next;
  }
  return p;
}

function alignSelections(cx: Context): void {
  const doc = docOf(cx);
  const sel = selOf(cx);
  const tabWidth = cx.editor.config.tabWidth;
  const columnWidths: number[] = [];
  const coordinates: { row: number; col: number }[] = [];
  let previousLine = -1;
  let colIdx = 0;
  let runningOffset = 0;
  for (const range of sel.ranges) {
    const coords = visualCoords(doc, range.head, tabWidth);
    const anchorCoords = visualCoords(doc, range.anchor, tabWidth);
    if (coords.row !== anchorCoords.row) {
      cx.editor.setError("align cannot work with multi line selections");
      return;
    }
    if (coords.row !== previousLine) {
      colIdx = 0;
      runningOffset = 0;
      previousLine = coords.row;
    }
    const width = coords.col - runningOffset;
    if (colIdx < columnWidths.length) columnWidths[colIdx] = Math.max(columnWidths[colIdx]!, width);
    else columnWidths.push(width);
    coordinates.push(coords);
    runningOffset += width;
    colIdx++;
  }
  const positions: number[] = [];
  let sum = 0;
  for (const w of columnWidths) {
    sum += w;
    positions.push(sum);
  }
  previousLine = -1;
  const changes: [number, number, string][] = [];
  sel.ranges.forEach((range, i) => {
    const coords = coordinates[i]!;
    if (coords.row !== previousLine) {
      colIdx = 0;
      runningOffset = 0;
      previousLine = coords.row;
    }
    const inserts = positions[colIdx]! - coords.col - runningOffset;
    colIdx++;
    runningOffset += inserts;
    changes.push([range.from(), range.from(), " ".repeat(Math.max(0, inserts))]);
  });
  apply(cx, changeSetOf(doc, changes));
  exitSelectMode(cx);
}

function copySelectionOnLine(cx: Context, direction: "forward" | "backward"): void {
  const count = cx.count();
  const doc = docOf(cx);
  const sel = selOf(cx);
  const tabWidth = cx.editor.config.tabWidth;
  const ranges: Range[] = [...sel.ranges];
  let primaryIndex = 0;
  for (const range of sel.ranges) {
    const isPrimary = range === sel.primary();
    const [head, anchor] =
      range.anchor < range.head
        ? [prevCharOrSame(doc, range.head), range.anchor]
        : [range.head, Math.max(0, prevCharOrSame(doc, range.anchor))];
    const headPos = visualCoords(doc, head, tabWidth);
    const anchorPos = visualCoords(doc, anchor, tabWidth);
    const height = Math.max(headPos.row, anchorPos.row) - Math.min(headPos.row, anchorPos.row) + 1;
    if (isPrimary) primaryIndex = ranges.length;
    ranges.push(range);
    let sels = 0;
    let i = 0;
    while (sels < count) {
      const offset = (i + 1) * height;
      const anchorRow = direction === "forward" ? anchorPos.row + offset : Math.max(0, anchorPos.row - offset);
      const headRow = direction === "forward" ? headPos.row + offset : Math.max(0, headPos.row - offset);
      if (anchorRow >= doc.lines || headRow >= doc.lines) break;
      const a = posAtVisualCoords(doc, anchorRow, anchorPos.col, tabWidth);
      const h = posAtVisualCoords(doc, headRow, headPos.col, tabWidth);
      if (
        visualCoords(doc, a, tabWidth).col === anchorPos.col &&
        visualCoords(doc, h, tabWidth).col === headPos.col
      ) {
        if (isPrimary) primaryIndex = ranges.length;
        ranges.push(Range.point(a).putCursor(doc, h, true));
        sels++;
      }
      if (anchorRow === 0 && headRow === 0) break;
      i++;
    }
  }
  setSel(cx, new Selection(ranges, primaryIndex));
}

function prevCharOrSame(doc: Text, pos: number): number {
  const ch = charBefore(doc, pos);
  return ch === null ? 0 : pos - ch.length;
}

export function regexPrompt(
  cx: Context,
  label: string,
  register: string,
  onEvent: (cx: Context, re: Pattern, event: "update" | "validate") => void,
): void {
  const editor = cx.editor;
  const host = cx.host;
  const snapshot = selOf(cx);
  const fresh = () => new Context(editor, host, null, null);
  editor.prompt(cx, {
    label,
    history: register,
    onChange: (input) => {
      if (input === "") return;
      const re = compile(editor, input);
      const pcx = fresh();
      setSel(pcx, snapshot);
      if (!(re instanceof Error)) onEvent(pcx, re, "update");
    },
    onAccept: (input) => {
      if (input === "") return;
      const re = compile(editor, input);
      const pcx = fresh();
      setSel(pcx, snapshot);
      if (re instanceof Error) {
        editor.setError(re.message);
        return;
      }
      jumplistFor(pcx).push({ docId: host.id, selection: snapshot });
      onEvent(pcx, re, "validate");
    },
    onCancel: () => setSel(fresh(), snapshot),
  });
}

function compile(editor: Context["editor"], input: string): Pattern | Error {
  const insensitive = editor.config.search.smartCase ? ![...input].some((c) => isUppercase(c)) : false;
  try {
    return compilePattern(input, insensitive);
  } catch (err) {
    return err as Error;
  }
}

export function searchImpl(
  cx: Context,
  re: Pattern,
  movement: "move" | "extend",
  direction: "forward" | "backward",
  wrapAround: boolean,
  showWarnings: boolean,
): void {
  const doc = docOf(cx);
  const sel = selOf(cx);
  const start =
    direction === "forward"
      ? ensureGraphemeBoundaryNext(doc, sel.primary().to())
      : ensureGraphemeBoundaryPrev(doc, sel.primary().from());
  let mat: [number, number] | null =
    direction === "forward" ? re.find(doc, start, doc.length) : re.findLast(doc, 0, start);
  if (!mat) {
    if (wrapAround) {
      mat = direction === "forward" ? re.find(doc, 0, doc.length) : re.findLast(doc, start, doc.length);
    }
    if (showWarnings) {
      if (wrapAround && mat) cx.editor.setStatus("Wrapped around document");
      else cx.editor.setError("No more matches");
    }
  }
  if (!mat) return;
  const [mStart, mEnd] = mat;
  if (mEnd === 0) return;
  const primary = sel.primary();
  const range = new Range(mStart, mEnd).withDirection(primary.direction());
  const next =
    movement === "extend"
      ? new Selection([...sel.ranges, range], sel.ranges.length)
      : new Selection(
          sel.ranges.map((r, i) => (i === sel.primaryIndex ? range : r)),
          sel.primaryIndex,
        );
  setSel(cx, next, { scrollIntoView: true });
}

function searcher(cx: Context, direction: "forward" | "backward"): void {
  const reg = cx.register ?? "/";
  const wrapAround = cx.editor.config.search.wrapAround;
  const movement = modeOf(cx) === "select" ? "extend" : "move";
  regexPrompt(cx, "search:", reg, (pcx, re, event) => {
    if (event === "validate") pcx.editor.registers.lastSearchRegister = reg;
    searchImpl(pcx, re, movement, direction, wrapAround, false);
  });
}

function searchNextOrPrev(cx: Context, movement: "move" | "extend", direction: "forward" | "backward"): void {
  const count = cx.count();
  const register = cx.register ?? cx.editor.registers.lastSearchRegister;
  const query = cx.editor.registers.first(register, cx.editor.registerEnv(cx.host));
  if (query === null) return;
  const insensitive = cx.editor.config.search.smartCase ? ![...query].some((c) => isUppercase(c)) : false;
  let re: Pattern;
  try {
    re = compilePattern(query, insensitive);
  } catch {
    cx.editor.setError(`Invalid regex: ${query}`);
    return;
  }
  for (let i = 0; i < count; i++) {
    searchImpl(cx, re, movement, direction, cx.editor.config.search.wrapAround, true);
  }
}

function searchSelectionImpl(cx: Context, detectWordBoundaries: boolean): void {
  const register = cx.register ?? "/";
  const doc = docOf(cx);
  const atWordStart = (index: number) => {
    if (index === doc.length) return false;
    const ch = charAt(doc, index)!;
    if (index === 0) return charIsWord(ch);
    return !charIsWord(charBefore(doc, index)!) && charIsWord(ch);
  };
  const atWordEnd = (index: number) => {
    if (index === 0 || index === doc.length) return false;
    return charIsWord(charBefore(doc, index)!) && !charIsWord(charAt(doc, index)!);
  };
  const parts: string[] = [];
  for (const range of selOf(cx).ranges) {
    const prefix = detectWordBoundaries && atWordStart(range.from()) ? "\\b" : "";
    const suffix = detectWordBoundaries && atWordEnd(range.to()) ? "\\b" : "";
    const word = escapeRegex(doc.sliceString(range.from(), range.to()));
    const regex = `${prefix}${word}${suffix}`;
    if (!parts.includes(regex)) parts.push(regex);
  }
  const regex = parts.join("|");
  try {
    cx.editor.registers.push(register, regex);
    cx.editor.registers.lastSearchRegister = register;
    cx.editor.setStatus(`register '${register}' set to '${regex}'`);
  } catch (err) {
    cx.editor.setError((err as Error).message);
  }
}

function makeSearchWordBounded(cx: Context): void {
  const register = cx.register ?? cx.editor.registers.lastSearchRegister;
  const regex = cx.editor.registers.first(register, cx.editor.registerEnv(cx.host));
  if (regex === null) return;
  const startAnchored = regex.startsWith("\\b");
  const endAnchored = regex.endsWith("\\b");
  if (startAnchored && endAnchored) return;
  const next = `${startAnchored ? "" : "\\b"}${regex}${endAnchored ? "" : "\\b"}`;
  try {
    cx.editor.registers.push(register, next);
    cx.editor.registers.lastSearchRegister = register;
    cx.editor.setStatus(`register '${register}' set to '${next}'`);
  } catch (err) {
    cx.editor.setError((err as Error).message);
  }
}

export const selectCommands: Record<string, CommandFn> = {
  extend_line: (cx) => extendLineImpl(cx, selOf(cx).primary().direction() === "forward" ? "below" : "above"),
  extend_line_below: (cx) => extendLineImpl(cx, "below"),
  extend_line_above: (cx) => extendLineImpl(cx, "above"),
  select_line_below: (cx) => selectLineImpl(cx, "below"),
  select_line_above: (cx) => selectLineImpl(cx, "above"),
  extend_to_line_bounds: (cx) => {
    const doc = docOf(cx);
    setSel(
      cx,
      selOf(cx).transform((range) => {
        const [startLine, endLine] = lineRange(doc, range);
        const start = lineToChar(doc, startLine);
        const end = lineToChar(doc, Math.min(endLine + 1, doc.lines));
        return new Range(start, end).withDirection(range.direction());
      }),
    );
  },
  shrink_to_line_bounds: (cx) => {
    const doc = docOf(cx);
    setSel(
      cx,
      selOf(cx).transform((range) => {
        const [startLine, endLine] = lineRange(doc, range);
        if (startLine === endLine) return range;
        let start = lineToChar(doc, startLine);
        let end = lineToChar(doc, Math.min(endLine + 1, doc.lines));
        if (start !== range.from()) start = lineToChar(doc, Math.min(startLine + 1, doc.lines));
        if (end !== range.to()) end = lineToChar(doc, endLine);
        return new Range(start, end).withDirection(range.direction());
      }),
    );
  },
  select_all: (cx) => setSel(cx, Selection.single(0, docOf(cx).length)),
  split_selection_on_newline: (cx) => setSel(cx, splitOnNewline(docOf(cx), selOf(cx))),
  merge_selections: (cx) => setSel(cx, mergeRanges(selOf(cx))),
  merge_consecutive_selections: (cx) => setSel(cx, mergeConsecutiveRanges(selOf(cx))),
  collapse_selection: collapseSelection,
  flip_selections: (cx) => setSel(cx, selOf(cx).transform((r) => r.flip())),
  ensure_selections_forward: (cx) => setSel(cx, selOf(cx).transform((r) => r.withDirection("forward"))),
  keep_primary_selection: keepPrimarySelection,
  remove_primary_selection: (cx) => {
    const sel = selOf(cx);
    if (sel.ranges.length === 1) {
      cx.editor.setError("no selections remaining");
      return;
    }
    const index = sel.primaryIndex;
    const ranges = sel.ranges.filter((_, i) => i !== index);
    let primary = sel.primaryIndex;
    if (index < primary || primary === ranges.length) primary -= 1;
    setSel(cx, new Selection(ranges, Math.max(0, primary)));
  },
  rotate_selections_forward: (cx) => rotateSelections(cx, "forward"),
  rotate_selections_backward: (cx) => rotateSelections(cx, "backward"),
  rotate_selections_first: (cx) => setSel(cx, new Selection(selOf(cx).ranges, 0)),
  rotate_selections_last: (cx) => setSel(cx, new Selection(selOf(cx).ranges, selOf(cx).ranges.length - 1)),
  trim_selections: trimSelections,
  align_selections: alignSelections,
  copy_selection_on_next_line: (cx) => copySelectionOnLine(cx, "forward"),
  copy_selection_on_prev_line: (cx) => copySelectionOnLine(cx, "backward"),
  select_regex: (cx) => {
    const reg = cx.register ?? "/";
    regexPrompt(cx, "select:", reg, (pcx, re, event) => {
      const next = selectOnMatches(docOf(pcx), selOf(pcx), re);
      if (next) setSel(pcx, next);
      else if (event === "validate") pcx.editor.setError("nothing selected");
    });
  },
  split_selection: (cx) => {
    const reg = cx.register ?? "/";
    regexPrompt(cx, "split:", reg, (pcx, re) => setSel(pcx, splitOnMatches(docOf(pcx), selOf(pcx), re)));
  },
  keep_selections: (cx) => keepOrRemove(cx, false),
  remove_selections: (cx) => keepOrRemove(cx, true),
  search: (cx) => searcher(cx, "forward"),
  rsearch: (cx) => searcher(cx, "backward"),
  search_next: (cx) => searchNextOrPrev(cx, "move", "forward"),
  search_prev: (cx) => searchNextOrPrev(cx, "move", "backward"),
  extend_search_next: (cx) => searchNextOrPrev(cx, "extend", "forward"),
  extend_search_prev: (cx) => searchNextOrPrev(cx, "extend", "backward"),
  search_selection: (cx) => searchSelectionImpl(cx, false),
  search_selection_detect_word_boundaries: (cx) => searchSelectionImpl(cx, true),
  make_search_word_bounded: makeSearchWordBounded,
};

function keepOrRemove(cx: Context, remove: boolean): void {
  const reg = cx.register ?? "/";
  regexPrompt(cx, remove ? "remove:" : "keep:", reg, (pcx, re, event) => {
    const next = keepOrRemoveMatches(docOf(pcx), selOf(pcx), re, remove);
    if (next) setSel(pcx, next);
    else if (event === "validate") pcx.editor.setError("no selections remaining");
  });
}

function rotateSelections(cx: Context, direction: "forward" | "backward"): void {
  const count = cx.count();
  const sel = selOf(cx);
  const len = sel.ranges.length;
  const index = sel.primaryIndex;
  const next = direction === "forward" ? (index + count) % len : (index + (Math.max(0, len - count) % len)) % len;
  setSel(cx, new Selection(sel.ranges, next));
}

export { nextCharPos, prevGraphemeBoundary };
