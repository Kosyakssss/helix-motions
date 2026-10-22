import type { Text } from "@codemirror/state";
import type { Context } from "../core/editor";
import { nextGraphemeBoundary, prevGraphemeBoundary } from "../graphemes";
import { Range, Selection } from "../selection";
import { charAt, charIsLineEnding, isLowercase, isUppercase, lineIndex } from "../core/text";
import { indentUnit, indentWidth } from "../config";
import { getPair } from "../match-brackets";
import { findMatchingBracketPlaintext } from "../match-brackets";
import { getSurroundPos, SurroundError } from "../surround";
import {
  textobjectPairSurround,
  textobjectPairSurroundClosest,
  textobjectParagraph,
  textobjectWord,
  type TextObject,
} from "../textobject";
import { applyMotion, type CommandFn } from "./motion";
import {
  apply,
  changeBySelection,
  changeSetOf,
  deleteChanges,
  dispatchHelix,
  docOf,
  enterInsertMode,
  exitSelectMode,
  firstNonWhitespaceChar,
  fragments,
  lineEndCharIndex,
  lineRange,
  lineToChar,
  modeOf,
  selOf,
  setModeOnly,
  setSel,
  type Change,
} from "./util";
import { commitHistoryNow, jumplistFor, pushJump } from "./jumps";
import { incrementInteger, incrementDateTime } from "../increment";
import { helixField, historyField } from "../state";

function enterNormalMode(cx: Context): void {
  const value = cx.host.state.field(helixField);
  if (value.mode === "normal") return;
  const doc = docOf(cx);
  tryRestoreIndent(cx);
  const after = cx.host.state.field(helixField);
  let sel = after.selection;
  if (after.restoreCursor) {
    sel = sel.transform((range) => {
      let head = range.to();
      if (range.head > range.anchor) head = prevGraphemeBoundary(docOf(cx), head);
      return new Range(range.from(), head);
    });
  }
  void doc;
  dispatchHelix(cx.host, { mode: "normal", selection: sel, restoreCursor: false });
}

function tryRestoreIndent(cx: Context): void {
  const pending = cx.host.state.field(historyField).pending;
  if (!pending) return;
  const changes: [number, number, number, number, string][] = [];
  pending.changes.iterChanges((fromA, toA, fromB, toB, text) => changes.push([fromA, toA, fromB, toB, text.toString()]));
  if (changes.length !== 1) return;
  const [fromA, toA, , , inserted] = changes[0]!;
  if (fromA !== toA || fromA === 0 || toA >= pending.changes.length) return;
  const doc = docOf(cx);
  const range = selOf(cx).primary();
  const pos = range.cursor(doc);
  const line = lineIndex(doc, pos);
  const lineEndPos = lineEndCharIndex(doc, line);
  const ok =
    fromA + inserted.length === pos &&
    (inserted.startsWith("\n") || inserted.startsWith("\r")) &&
    /^[\t \u00a0\u180e\u202f\u205f\u3000\ufeff\u2000-\u200b]*$/.test(inserted.slice(1)) &&
    pos === lineEndPos;
  if (!ok) return;
  apply(cx, changeSetOf(doc, [[lineToChar(doc, line), pos, null]]));
}

export function insertMode(cx: Context): void {
  const sel = selOf(cx).transform((range) => new Range(range.to(), range.from()));
  dispatchHelix(cx.host, { mode: "insert", selection: sel });
}

export function appendMode(cx: Context): void {
  dispatchHelix(cx.host, { mode: "insert", restoreCursor: true });
  const doc = docOf(cx);
  const end = doc.length;
  const sel = selOf(cx);
  const last = sel.ranges[sel.ranges.length - 1]!;
  if (!last.isEmpty() && last.to() === end) {
    apply(cx, changeSetOf(doc, [[end, end, "\n"]]));
  }
  const doc2 = docOf(cx);
  setSel(cx, selOf(cx).transform((range) => new Range(range.from(), nextGraphemeBoundary(doc2, range.to()))));
}

function selectMode(cx: Context): void {
  const doc = docOf(cx);
  const sel = selOf(cx).transform((range) => {
    if (range.isEmpty() && range.head === doc.length) {
      return new Range(prevGraphemeBoundary(doc, range.anchor), range.head);
    }
    return range;
  });
  dispatchHelix(cx.host, { mode: "select", selection: sel });
}

function insertWithIndent(cx: Context, fallback: "lineStart" | "lineEnd"): void {
  const wasSelect = modeOf(cx) === "select";
  enterInsertMode(cx);
  const doc = docOf(cx);
  const sel = selOf(cx);
  const ranges: Range[] = [];
  const changes: Change[] = [];
  let offs = 0;
  for (const range of sel.ranges) {
    const line = lineIndex(doc, range.cursor(doc));
    const lineStart = lineToChar(doc, line);
    if (lineEndCharIndex(doc, line) === lineStart) {
      const indent = indentFor(cx, doc, line);
      const pos = offs + lineStart;
      ranges.push(Range.point(pos + indent.length));
      offs += indent.length;
      changes.push([lineStart, lineStart, indent]);
    } else {
      let pos: number;
      if (fallback === "lineStart") {
        const off = firstNonWhitespaceChar(doc, line);
        pos = off === null ? lineStart : lineStart + off;
      } else {
        pos = lineEndCharIndex(doc, line);
      }
      ranges.push(range.putCursor(doc, pos + offs, wasSelect));
      changes.push([lineStart, lineStart, null]);
    }
  }
  apply(cx, changeSetOf(doc, changes), new Selection(ranges, sel.primaryIndex));
}

function indentFor(cx: Context, doc: Text, line: number): string {
  const config = cx.editor.config;
  const width = indentWidth(config);
  let len = 0;
  for (const ch of doc.line(line + 1).text) {
    if (ch === "\t") len += config.tabWidth - (len % config.tabWidth);
    else if (ch === " ") len += 1;
    else break;
  }
  return indentUnit(config).repeat(Math.floor(len / width));
}

const LIST_MARKER = /^([ \t]*)((?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?|>[ \t]?)/;

function continuedListMarker(doc: Text, line: number): string | null {
  const m = LIST_MARKER.exec(doc.line(line + 1).text);
  if (!m) return null;
  let marker = m[2]!;
  const num = /^(\d+)([.)])/.exec(marker);
  if (num) marker = String(Number(num[1]) + 1) + marker.slice(num[1]!.length);
  marker = marker.replace(/\[[xX]\]/, "[ ]");
  return marker;
}

export function openLines(cx: Context, open: "below" | "above"): void {
  const count = cx.count();
  enterInsertMode(cx);
  const doc = docOf(cx);
  const sel = selOf(cx);
  let offs = 0;
  const ranges: Range[] = [];
  const changes: Change[] = [];
  for (const range of sel.ranges) {
    const currLine = lineIndex(doc, open === "below" ? prevGraphemeBoundary(doc, range.to()) : range.from());
    const nextNewLine = open === "below" ? currLine + 1 : currLine;
    const aboveNext = Math.max(0, nextNewLine - 1);
    const [aboveEnd, aboveEndWidth] = nextNewLine === 0 ? [0, 0] : [lineEndCharIndex(doc, aboveNext), 1];
    const continueToken = cx.editor.continueLists && open === "below" ? continuedListMarker(doc, currLine) : null;
    const lineText = doc.line(currLine + 1).text;
    const firstNonWs = firstNonWhitespaceChar(doc, currLine);
    const indent =
      continueToken !== null && firstNonWs !== null ? lineText.slice(0, firstNonWs) : indentFor(cx, doc, currLine);
    const token = continueToken ?? "";
    let text: string;
    if (open === "above" && nextNewLine === 0) text = indent + token + "\n";
    else text = "\n" + indent + token;
    text = text.repeat(count);
    const pos = offs + aboveEnd + aboveEndWidth;
    for (let i = 0; i < count; i++) {
      ranges.push(Range.point(pos + i * (1 + indent.length + token.length) + indent.length + token.length));
    }
    offs += text.length;
    changes.push([aboveEnd, aboveEnd, text]);
  }
  apply(cx, changeSetOf(doc, changes), new Selection(ranges, sel.primaryIndex));
}

function selectionIsLinewise(doc: Text, sel: Selection): boolean {
  return sel.ranges.every((range) => {
    const frag = doc.sliceString(range.from(), range.to());
    if (frag.split("\n").length < 2) return false;
    const [startLine, endLine] = lineRange(doc, range);
    const start = lineToChar(doc, startLine);
    const end = lineToChar(doc, Math.min(endLine + 1, doc.lines));
    return start === range.from() && end === range.to();
  });
}

function deleteSelectionImpl(cx: Context, op: "delete" | "change", yank: boolean): void {
  const doc = docOf(cx);
  const sel = selOf(cx);
  const onlyWholeLines = selectionIsLinewise(doc, sel);
  if (cx.register !== "_" && yank) {
    const reg = cx.register ?? cx.editor.config.defaultYankRegister;
    try {
      cx.editor.registers.write(reg, fragments(doc, sel));
    } catch (err) {
      cx.editor.setError((err as Error).message);
      return;
    }
  }
  apply(cx, deleteChanges(doc, sel.ranges.map((r) => [r.from(), r.to()])));
  if (op === "delete") exitSelectMode(cx);
  else if (onlyWholeLines) openLines(cx, "above");
  else enterInsertMode(cx);
}

function replaceCommand(cx: Context): void {
  cx.onNextKey((cx, key) => {
    let ch: string | null;
    if (key === "ret") ch = "\n";
    else if (key === "tab") ch = "\t";
    else ch = cx.editor.keyChar(key);
    if (ch === null) return;
    const doc = docOf(cx);
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    changeBySelection(cx, (range) => {
      if (range.isEmpty()) return [range.from(), range.to(), null];
      const text = [...seg.segment(doc.sliceString(range.from(), range.to()))].map(() => ch).join("");
      return [range.from(), range.to(), text];
    });
    exitSelectMode(cx);
  });
}

function switchCaseImpl(cx: Context, f: (s: string) => string): void {
  const doc = docOf(cx);
  changeBySelection(cx, (range) => [range.from(), range.to(), f(doc.sliceString(range.from(), range.to()))]);
  exitSelectMode(cx);
}

function yankImpl(cx: Context, register: string): void {
  const values = fragments(docOf(cx), selOf(cx));
  const n = values.length;
  try {
    cx.editor.registers.write(register, values);
    cx.editor.setStatus(`yanked ${n} selection${n === 1 ? "" : "s"} to register ${register}`);
  } catch (err) {
    cx.editor.setError((err as Error).message);
  }
}

function yankJoinedImpl(cx: Context, separator: string, register: string): void {
  const values = fragments(docOf(cx), selOf(cx));
  const n = values.length;
  try {
    cx.editor.registers.write(register, [values.join(separator)]);
    cx.editor.setStatus(`joined and yanked ${n} selection${n === 1 ? "" : "s"} to register ${register}`);
  } catch (err) {
    cx.editor.setError((err as Error).message);
  }
}

export function yankJoinedTo(cx: Context, separator: string, register: string): void {
  yankJoinedImpl(cx, separator, register);
}

function yankMainSelection(cx: Context, register: string): void {
  const range = selOf(cx).primary();
  try {
    cx.editor.registers.write(register, [docOf(cx).sliceString(range.from(), range.to())]);
    cx.editor.setStatus(`yanked primary selection to register ${register}`);
  } catch (err) {
    cx.editor.setError((err as Error).message);
  }
}

export type PastePos = "before" | "after" | "cursor";

export function pasteImpl(cx: Context, values: string[], action: PastePos, count: number): void {
  if (values.length === 0) return;
  const mode = modeOf(cx);
  if (mode === "insert") commitHistoryNow(cx.host);
  const linewise = values.some((v) => v.endsWith("\n") || v.endsWith("\r"));
  const mapValue = (v: string) => v.replace(/\r\n|\r|\n/g, "\n").repeat(count);
  const mapped = values.map(mapValue);
  const lastValue = mapped[mapped.length - 1]!;
  const doc = docOf(cx);
  const sel = selOf(cx);
  let offset = 0;
  const ranges: Range[] = [];
  const changes: Change[] = [];
  sel.ranges.forEach((range, i) => {
    let pos: number;
    if (action === "before" && linewise) pos = lineToChar(doc, lineIndex(doc, range.from()));
    else if (action === "after" && linewise) {
      const line = lineRange(doc, range)[1];
      pos = lineToChar(doc, Math.min(line + 1, doc.lines));
    } else if (action === "before") pos = range.from();
    else if (action === "after") pos = range.to();
    else pos = range.cursor(doc);
    const value = mapped[i] ?? lastValue;
    const anchor = offset + pos;
    ranges.push(new Range(anchor, anchor + value.length).withDirection(range.direction()));
    offset += value.length;
    changes.push([pos, pos, value]);
  });
  apply(cx, changeSetOf(doc, changes), mode === "normal" ? new Selection(ranges, sel.primaryIndex) : null);
  commitHistoryNow(cx.host);
}

export function paste(cx: Context, register: string, pos: PastePos, count: number): void {
  const values = cx.editor.registers.read(register, cx.editor.registerEnv(cx.host));
  if (!values) return;
  pasteImpl(cx, values, pos, count);
}

export function replaceSelectionsWithRegister(cx: Context, register: string, count: number): void {
  const values = cx.editor.registers.read(register, cx.editor.registerEnv(cx.host));
  if (!values || values.length === 0) return;
  const mapValue = (v: string) => v.replace(/\r\n|\r|\n/g, "\n").repeat(count);
  const mapped = values.map(mapValue);
  const last = mapped[mapped.length - 1]!;
  let i = 0;
  changeBySelection(cx, (range) => {
    if (range.isEmpty()) return [range.from(), range.to(), null];
    const v = mapped[i] ?? last;
    i++;
    return [range.from(), range.to(), v];
  });
  commitHistoryNow(cx.host);
}

function getLines(doc: Text, sel: Selection): number[] {
  const lines = new Set<number>();
  for (const range of sel.ranges) {
    const [start, end] = lineRange(doc, range);
    for (let l = start; l <= end; l++) lines.add(l);
  }
  return [...lines].sort((a, b) => a - b);
}

function indentCommand(cx: Context): void {
  const count = cx.count();
  const doc = docOf(cx);
  const config = cx.editor.config;
  const indent = indentUnit(config).repeat(count);
  const changes: Change[] = [];
  for (const line of getLines(doc, selOf(cx))) {
    const text = doc.line(line + 1).text;
    if (text.trim() === "") continue;
    const pos = lineToChar(doc, line);
    let ind = indent;
    if (config.indentStyle.kind === "spaces") {
      const offset = (firstNonWhitespaceChar(doc, line) ?? 0) % config.indentStyle.width;
      ind = indent.slice(offset);
    }
    changes.push([pos, pos, ind]);
  }
  apply(cx, changeSetOf(doc, changes));
  exitSelectMode(cx);
}

function unindentCommand(cx: Context): void {
  const count = cx.count();
  const doc = docOf(cx);
  const config = cx.editor.config;
  const width = count * indentWidth(config);
  const changes: Change[] = [];
  for (const lineIdx of getLines(doc, selOf(cx))) {
    const text = doc.line(lineIdx + 1).text;
    let w = 0;
    let pos = 0;
    for (const ch of text) {
      if (ch === " ") w += 1;
      else if (ch === "\t") w = (Math.floor(w / config.tabWidth) + 1) * config.tabWidth;
      else break;
      pos += 1;
      if (w >= width) break;
    }
    if (pos > 0) {
      const start = lineToChar(doc, lineIdx);
      changes.push([start, start + pos, null]);
    }
  }
  apply(cx, changeSetOf(doc, changes));
  exitSelectMode(cx);
}

function joinSelectionsImpl(cx: Context, selectSpace: boolean): void {
  const doc = docOf(cx);
  const changes: Change[] = [];
  const skipSpaces = (pos: number) => {
    while (pos < doc.length) {
      const ch = charAt(doc, pos);
      if (ch !== " " && ch !== "\t") break;
      pos++;
    }
    return pos;
  };
  for (const range of selOf(cx).ranges) {
    let [start, end] = lineRange(doc, range);
    if (start === end) end = Math.min(end + 1, doc.lines - 1);
    for (let line = start; line < end; line++) {
      const from = lineEndCharIndex(doc, line);
      const to = skipSpaces(lineToChar(doc, line + 1));
      const separator = to === lineEndCharIndex(doc, line + 1) ? null : " ";
      changes.push([from, to, separator]);
    }
  }
  if (changes.length === 0) return;
  changes.sort((a, b) => a[0] - b[0]);
  const deduped: Change[] = [];
  for (const c of changes) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev[0] === c[0] && prev[1] === c[1] && prev[2] === c[2]) continue;
    deduped.push(c);
  }
  if (selectSpace) {
    let offset = 0;
    const ranges: Range[] = [];
    for (const c of deduped) {
      if (c[2] !== null) {
        ranges.push(Range.point(c[0] - offset));
        offset += c[1] - c[0] - 1;
      } else {
        offset += c[1] - c[0];
      }
    }
    apply(cx, changeSetOf(doc, deduped), ranges.length > 0 ? new Selection(ranges, 0) : null);
  } else {
    apply(cx, changeSetOf(doc, deduped));
  }
}

function addNewlineImpl(cx: Context, open: "above" | "below"): void {
  const count = cx.count();
  const doc = docOf(cx);
  const changes: Change[] = selOf(cx).ranges.map((range) => {
    const [start, end] = lineRange(doc, range);
    const pos = lineToChar(doc, open === "above" ? start : end + 1);
    return [pos, pos, "\n".repeat(count)];
  });
  apply(cx, changeSetOf(doc, changes));
}

function incrementImpl(cx: Context, sign: 1 | -1): void {
  let amount = sign * cx.count();
  const increaseBy = cx.register === "#" ? sign : 0;
  const doc = docOf(cx);
  const sel = selOf(cx);
  const ranges: Range[] = [];
  let diff = 0;
  const changes: Change[] = [];
  for (const range of sel.ranges) {
    const text = doc.sliceString(range.from(), range.to());
    const newFrom = range.from() + diff;
    const incremented = incrementInteger(text, amount) ?? incrementDateTime(text, amount);
    amount += increaseBy;
    if (incremented === null) {
      ranges.push(new Range(newFrom, range.to() + diff));
    } else {
      ranges.push(new Range(newFrom, newFrom + incremented.length));
      diff += incremented.length - text.length;
      changes.push([range.from(), range.to(), incremented]);
    }
  }
  if (changes.length > 0) {
    apply(cx, changeSetOf(doc, changes), new Selection(ranges, sel.primaryIndex));
    exitSelectMode(cx);
  }
}

function surroundAdd(cx: Context): void {
  cx.onNextKey((cx, key) => {
    cx.editor.autoinfo = null;
    let open: string;
    let close: string;
    const ch = cx.editor.keyChar(key);
    if (ch !== null) [open, close] = getPair(ch);
    else if (key === "ret") [open, close] = ["\n", "\n"];
    else return;
    const surroundLen = open.length + close.length;
    const doc = docOf(cx);
    const sel = selOf(cx);
    const changes: Change[] = [];
    const ranges: Range[] = [];
    let offs = 0;
    for (const range of sel.ranges) {
      changes.push([range.from(), range.from(), open]);
      changes.push([range.to(), range.to(), close]);
      ranges.push(new Range(offs + range.from(), offs + range.to() + surroundLen).withDirection(range.direction()));
      offs += surroundLen;
    }
    apply(cx, changeSetOf(doc, changes), new Selection(ranges, sel.primaryIndex));
    exitSelectMode(cx);
  });
}

function surroundReplace(cx: Context): void {
  const count = cx.count();
  cx.onNextKey((cx, key) => {
    cx.editor.autoinfo = null;
    const ch = cx.editor.keyChar(key);
    if (ch === null) return;
    const surroundCh = ch === "m" ? null : ch;
    const doc = docOf(cx);
    const sel = selOf(cx);
    let changePos: number[];
    try {
      changePos = getSurroundPos(doc, sel, surroundCh, count);
    } catch (err) {
      cx.editor.setError(err instanceof SurroundError ? err.message : String(err));
      return;
    }
    setSel(cx, new Selection(changePos.map((p) => Range.point(p)), sel.primaryIndex * 2));
    cx.onNextKey((cx, key) => {
      cx.editor.autoinfo = null;
      const to = cx.editor.keyChar(key);
      if (to === null) {
        setSel(cx, sel);
        return;
      }
      const [open, close] = getPair(to);
      const sorted: [number, string][] = [];
      for (let i = 0; i < changePos.length; i += 2) {
        sorted.push([changePos[i]!, open]);
        sorted.push([changePos[i + 1]!, close]);
      }
      sorted.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1));
      const d = docOf(cx);
      setSel(cx, sel);
      apply(
        cx,
        changeSetOf(
          d,
          sorted.map(([p, c]) => [p, nextGraphemeBoundary(d, p), c]),
        ),
      );
      exitSelectMode(cx);
    });
  });
}

function surroundDelete(cx: Context): void {
  const count = cx.count();
  cx.onNextKey((cx, key) => {
    cx.editor.autoinfo = null;
    const ch = cx.editor.keyChar(key);
    if (ch === null) return;
    const surroundCh = ch === "m" ? null : ch;
    const doc = docOf(cx);
    let changePos: number[];
    try {
      changePos = getSurroundPos(doc, selOf(cx), surroundCh, count);
    } catch (err) {
      cx.editor.setError(err instanceof SurroundError ? err.message : String(err));
      return;
    }
    changePos.sort((a, b) => a - b);
    apply(cx, changeSetOf(doc, changePos.map((p) => [p, nextGraphemeBoundary(doc, p), null])));
    exitSelectMode(cx);
  });
}

function selectTextobject(cx: Context, objtype: TextObject): void {
  const count = cx.count();
  cx.onNextKey((cx, key) => {
    cx.editor.autoinfo = null;
    const ch = cx.editor.keyChar(key);
    if (ch === null) return;
    applyMotion(cx, (cx) => {
      const doc = docOf(cx);
      if (ch === "g") {
        cx.editor.setStatus("Diff is not available in current buffer");
        return;
      }
      if ("tfacTex".includes(ch)) return;
      setSel(
        cx,
        selOf(cx).transform((range) => {
          switch (ch) {
            case "w":
              return textobjectWord(doc, range, objtype, count, false);
            case "W":
              return textobjectWord(doc, range, objtype, count, true);
            case "p":
              return textobjectParagraph(doc, range, objtype, count);
            case "m":
              return textobjectPairSurroundClosest(doc, range, objtype, count);
            default:
              if (!/^[0-9A-Za-z]$/.test(ch)) return textobjectPairSurround(doc, range, objtype, ch, count);
              return range;
          }
        }),
      );
    });
  });
}

function matchBrackets(cx: Context): void {
  const doc = docOf(cx);
  const isSelect = modeOf(cx) === "select";
  setSel(
    cx,
    selOf(cx).transform((range) => {
      const pos = range.cursor(doc);
      const matched = findMatchingBracketPlaintext(doc, pos);
      return matched === null ? range : range.putCursor(doc, matched, isSelect);
    }),
  );
}

function reorderSelectionContents(cx: Context, strategy: "forward" | "backward" | "reverse"): void {
  const doc = docOf(cx);
  const sel = selOf(cx);
  const frags = fragments(doc, sel);
  const rotateBy = cx.countRaw === null ? 1 : Math.min(cx.countRaw, frags.length);
  let primary: number;
  if (strategy === "forward") {
    for (let i = 0; i < rotateBy; i++) frags.unshift(frags.pop()!);
    primary = (sel.primaryIndex + frags.length + rotateBy) % frags.length;
  } else if (strategy === "backward") {
    for (let i = 0; i < rotateBy; i++) frags.push(frags.shift()!);
    primary = (sel.primaryIndex + frags.length - rotateBy) % frags.length;
  } else {
    if (rotateBy % 2 === 0) return;
    frags.reverse();
    primary = frags.length - 1 - sel.primaryIndex;
  }
  setSel(cx, new Selection(sel.ranges, primary));
  apply(cx, changeSetOf(doc, sel.ranges.map((r, i) => [r.from(), r.to(), frags[i]!])));
}

function switchCase(s: string): string {
  let out = "";
  for (const ch of s) {
    if (isLowercase(ch)) out += ch.toUpperCase();
    else if (isUppercase(ch)) out += ch.toLowerCase();
    else out += ch;
  }
  return out;
}

export const editCommands: Record<string, CommandFn> = {
  normal_mode: enterNormalMode,
  insert_mode: insertMode,
  append_mode: appendMode,
  select_mode: selectMode,
  exit_select_mode: exitSelectMode,
  insert_at_line_start: (cx) => insertWithIndent(cx, "lineStart"),
  insert_at_line_end: (cx) => insertWithIndent(cx, "lineEnd"),
  open_below: (cx) => openLines(cx, "below"),
  open_above: (cx) => openLines(cx, "above"),
  delete_selection: (cx) => deleteSelectionImpl(cx, "delete", true),
  delete_selection_noyank: (cx) => deleteSelectionImpl(cx, "delete", false),
  change_selection: (cx) => deleteSelectionImpl(cx, "change", true),
  change_selection_noyank: (cx) => deleteSelectionImpl(cx, "change", false),
  replace: replaceCommand,
  switch_case: (cx) => switchCaseImpl(cx, switchCase),
  switch_to_uppercase: (cx) => switchCaseImpl(cx, (s) => s.toUpperCase()),
  switch_to_lowercase: (cx) => switchCaseImpl(cx, (s) => s.toLowerCase()),
  yank: (cx) => {
    yankImpl(cx, cx.register ?? cx.editor.config.defaultYankRegister);
    exitSelectMode(cx);
  },
  yank_to_clipboard: (cx) => {
    yankImpl(cx, "+");
    exitSelectMode(cx);
  },
  yank_to_primary_clipboard: (cx) => {
    yankImpl(cx, "*");
    exitSelectMode(cx);
  },
  yank_joined: (cx) => {
    yankJoinedImpl(cx, "\n", cx.register ?? cx.editor.config.defaultYankRegister);
    exitSelectMode(cx);
  },
  yank_joined_to_clipboard: (cx) => {
    yankJoinedImpl(cx, "\n", "+");
    exitSelectMode(cx);
  },
  yank_joined_to_primary_clipboard: (cx) => {
    yankJoinedImpl(cx, "\n", "*");
    exitSelectMode(cx);
  },
  yank_main_selection_to_clipboard: (cx) => {
    yankMainSelection(cx, "+");
    exitSelectMode(cx);
  },
  yank_main_selection_to_primary_clipboard: (cx) => {
    yankMainSelection(cx, "*");
    exitSelectMode(cx);
  },
  paste_after: (cx) => {
    paste(cx, cx.register ?? cx.editor.config.defaultYankRegister, "after", cx.count());
    exitSelectMode(cx);
  },
  paste_before: (cx) => {
    paste(cx, cx.register ?? cx.editor.config.defaultYankRegister, "before", cx.count());
    exitSelectMode(cx);
  },
  paste_clipboard_after: (cx) => {
    paste(cx, "+", "after", cx.count());
    exitSelectMode(cx);
  },
  paste_clipboard_before: (cx) => {
    paste(cx, "+", "before", cx.count());
    exitSelectMode(cx);
  },
  paste_primary_clipboard_after: (cx) => {
    paste(cx, "*", "after", cx.count());
    exitSelectMode(cx);
  },
  paste_primary_clipboard_before: (cx) => {
    paste(cx, "*", "before", cx.count());
    exitSelectMode(cx);
  },
  replace_with_yanked: (cx) => {
    replaceSelectionsWithRegister(cx, cx.register ?? cx.editor.config.defaultYankRegister, cx.count());
    exitSelectMode(cx);
  },
  replace_selections_with_clipboard: (cx) => {
    replaceSelectionsWithRegister(cx, "+", cx.count());
    exitSelectMode(cx);
  },
  replace_selections_with_primary_clipboard: (cx) => {
    replaceSelectionsWithRegister(cx, "*", cx.count());
    exitSelectMode(cx);
  },
  indent: indentCommand,
  unindent: unindentCommand,
  join_selections: (cx) => joinSelectionsImpl(cx, false),
  join_selections_space: (cx) => joinSelectionsImpl(cx, true),
  add_newline_above: (cx) => addNewlineImpl(cx, "above"),
  add_newline_below: (cx) => addNewlineImpl(cx, "below"),
  increment: (cx) => incrementImpl(cx, 1),
  decrement: (cx) => incrementImpl(cx, -1),
  surround_add: surroundAdd,
  surround_replace: surroundReplace,
  surround_delete: surroundDelete,
  select_textobject_around: (cx) => selectTextobject(cx, "around"),
  select_textobject_inner: (cx) => selectTextobject(cx, "inside"),
  match_brackets: matchBrackets,
  rotate_selection_contents_forward: (cx) => reorderSelectionContents(cx, "forward"),
  rotate_selection_contents_backward: (cx) => reorderSelectionContents(cx, "backward"),
  reverse_selection_contents: (cx) => reorderSelectionContents(cx, "reverse"),
  save_selection: (cx) => {
    pushJump(cx);
    cx.editor.setStatus("Selection saved to jumplist");
  },
  jump_forward: (cx) => {
    const jump = jumplistFor(cx).forward(cx.count());
    if (jump) cx.editor.jumpTo(cx, jump);
  },
  jump_backward: (cx) => {
    const here = { docId: cx.host.id, selection: selOf(cx) };
    const jump = jumplistFor(cx).backward(here, cx.count());
    if (jump) cx.editor.jumpTo(cx, jump);
  },
  select_register: (cx) => {
    cx.editor.autoinfoRegisters("Select register");
    cx.onNextKey((cx, key) => {
      cx.editor.autoinfo = null;
      const ch = cx.editor.keyChar(key);
      if (ch !== null) cx.editor.selectedRegister = ch;
    });
  },
  insert_register: (cx) => {
    const count = cx.count();
    cx.editor.autoinfoRegisters("Insert register");
    cx.onNextKey((cx, key) => {
      cx.editor.autoinfo = null;
      const ch = cx.editor.keyChar(key);
      if (ch !== null) {
        cx.register = ch;
        paste(cx, ch, "cursor", count);
      }
    });
  },
  copy_between_registers: (cx) => {
    cx.editor.autoinfoRegisters("Copy from register");
    cx.onNextKey((cx, key) => {
      cx.editor.autoinfo = null;
      const source = cx.editor.keyChar(key);
      if (source === null) return;
      const values = cx.editor.registers.read(source, cx.editor.registerEnv(cx.host));
      if (!values) {
        cx.editor.setError(`register ${source} is empty`);
        return;
      }
      cx.editor.autoinfoRegisters("Copy into register");
      cx.onNextKey((cx, key) => {
        cx.editor.autoinfo = null;
        const dest = cx.editor.keyChar(key);
        if (dest === null) return;
        try {
          cx.editor.registers.write(dest, values);
          const n = values.length;
          cx.editor.setStatus(`yanked ${n} value${n === 1 ? "" : "s"} from register ${source} to ${dest}`);
        } catch (err) {
          cx.editor.setError((err as Error).message);
        }
      });
    });
  },
  record_macro: (cx) => {
    const rec = cx.editor.macroRecording;
    if (rec) {
      cx.editor.macroRecording = null;
      const keys = rec.keys.slice(0, -1);
      const s = keys.map((k) => ([...k].length === 1 ? k : `<${k}>`)).join("");
      try {
        cx.editor.registers.write(rec.register, [s]);
        cx.editor.setStatus(`Recorded to register [${rec.register}]`);
      } catch (err) {
        cx.editor.setError((err as Error).message);
      }
    } else {
      const reg = cx.register ?? "@";
      cx.register = null;
      cx.editor.macroRecording = { register: reg, keys: [] };
      cx.editor.setStatus(`Recording to register [${reg}]`);
    }
  },
  replay_macro: (cx) => {
    const reg = cx.register ?? "@";
    if (cx.editor.macroReplaying.includes(reg)) {
      cx.editor.setError(
        `Cannot replay from register [${reg}] because already replaying from same register`,
      );
      return;
    }
    const values = cx.editor.registers.read(reg, cx.editor.registerEnv(cx.host));
    if (!values || values.length !== 1) {
      cx.editor.setError(`Register [${reg}] empty`);
      return;
    }
    let keys: string[];
    try {
      keys = cx.editor.parseMacro(values[0]!);
    } catch (err) {
      cx.editor.setError(`Invalid macro: ${(err as Error).message}`);
      return;
    }
    cx.editor.macroReplaying.push(reg);
    const count = cx.count();
    cx.callbacks.push(() => {
      for (let i = 0; i < count; i++) for (const key of keys) cx.editor.handleKey(cx.host, key);
      cx.editor.macroReplaying.pop();
    });
  },
};

export { charIsLineEnding, setModeOnly, lineEndCharIndex };
