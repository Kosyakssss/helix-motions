import type { Text } from "@codemirror/state";
import type { Context, HelixEditor } from "../core/editor";
import { selection, type Host } from "../core/host";
import {
  nextGraphemeBoundary,
  nthNextGraphemeBoundary,
  nthPrevGraphemeBoundary,
  prevGraphemeBoundary,
} from "../graphemes";
import { hookDelete, hookInsert, makeAutoPairs, type AutoPairs } from "../auto-pairs";
import { wordMove } from "../movement";
import { Range, Selection } from "../selection";
import { charAt, charBefore, isWhitespace, lineIndex } from "../core/text";
import { indentUnit, indentWidth } from "../config";
import {
  apply,
  changeByAndWithSelection,
  changeSetOf,
  deleteByAndWithSelection,
  deleteChanges,
  docOf,
  firstNonWhitespaceChar,
  lineEndCharIndex,
  lineToChar,
  modeOf,
  selOf,
  setModeOnly,
  setSel,
  type Change,
} from "./util";
import type { CommandFn } from "./motion";
import { commitHistoryNow } from "./jumps";

const MARKDOWN_AUTO_PAIRS: [string, string][] = [
  ["(", ")"],
  ["{", "}"],
  ["[", "]"],
  ['"', '"'],
  ["'", "'"],
  ["`", "`"],
  ["‘", "’"],
  ["«", "»"],
  ["“", "”"],
];

export function autoPairsFor(
  editor: HelixEditor,
  host: Host,
  differs: (global: AutoPairs, markdown: AutoPairs) => boolean = () => true,
): AutoPairs | null {
  const pairs = editor.config.autoPairs;
  if (!pairs || !editor.helixAutoPairs) return null;
  const global = makeAutoPairs(pairs);
  if (!editor.syntax) return global;
  const markdown = makeAutoPairs(MARKDOWN_AUTO_PAIRS);
  if (!differs(global, markdown)) return global;
  const syntax = editor.syntax(host);
  if (!syntax) return global;
  const primary = selection(host).primary();
  const layer = syntax.layerForByteRange(syntax.byteOf(primary.from()), syntax.byteOf(primary.to()));
  return layer.language.id === "markdown" ? markdown : global;
}

export function insertDiffers(doc: Text, ranges: readonly Range[], ch: string) {
  return (a: AutoPairs, b: AutoPairs) =>
    ranges.some((r) => JSON.stringify(hookInsert(doc, r, ch, a)) !== JSON.stringify(hookInsert(doc, r, ch, b)));
}

export function mayAutoPair(editor: HelixEditor, ch: string): boolean {
  const pairs = editor.config.autoPairs;
  if (!pairs || !editor.helixAutoPairs) return false;
  const has = (list: [string, string][]) => list.some(([open, close]) => open === ch || close === ch);
  return has(pairs) || (editor.syntax !== null && has(MARKDOWN_AUTO_PAIRS)) || isWhitespace(ch);
}

export function autoPairsOf(cx: Context) {
  return autoPairsFor(cx.editor, cx.host);
}

export function insertChar(cx: Context, ch: string): void {
  const doc = docOf(cx);
  const pairs = autoPairsFor(cx.editor, cx.host, insertDiffers(doc, selOf(cx).ranges, ch));
  changeByAndWithSelection(cx, (range) => {
    if (pairs) {
      const hooked = hookInsert(doc, range, ch, pairs);
      if (hooked) return hooked;
    }
    const cursor = range.cursor(doc);
    return [[cursor, cursor, ch], null];
  });
}

export function insertTabImpl(cx: Context, count: number): void {
  const doc = docOf(cx);
  const config = cx.editor.config;
  const unit = indentUnit(config);
  const changes: Change[] = selOf(cx).ranges.map((range) => {
    const cursor = range.cursor(doc);
    let indent = unit.repeat(count);
    if (config.indentStyle.kind === "spaces") {
      const line = lineIndex(doc, cursor);
      const offset = (cursor - lineToChar(doc, line)) % config.indentStyle.width;
      indent = indent.slice(offset);
    }
    return [cursor, cursor, indent];
  });
  apply(cx, changeSetOf(doc, changes));
}

export function smartTab(cx: Context): void {
  const doc = docOf(cx);
  if (cx.editor.config.smartTab.enable) {
    const afterWhitespace = selOf(cx).ranges.every((range) => {
      const cursor = range.cursor(doc);
      const start = lineToChar(doc, lineIndex(doc, cursor));
      return [...doc.sliceString(start, cursor)].every((c) => isWhitespace(c));
    });
    if (!afterWhitespace) return;
  }
  insertTabImpl(cx, 1);
}

function indentForNewline(cx: Context, doc: Text, line: number): string {
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

function lastNonWhitespace(s: string): number | null {
  const chars = [...s];
  let offset = s.length;
  for (let i = chars.length - 1; i >= 0; i--) {
    offset -= chars[i]!.length;
    if (!isWhitespace(chars[i]!)) return offset;
  }
  return null;
}

export function insertNewline(cx: Context): void {
  const doc = docOf(cx);
  const sel = selOf(cx);
  const pairs = autoPairsOf(cx);
  const unit = indentUnit(cx.editor.config);
  const ranges: Range[] = [];
  const changes: Change[] = [];
  let globalOffs = 0;
  let lastPos = 0;
  for (const range of sel.ranges) {
    let charsDeleted = 0;
    const pos = range.cursor(doc);
    const prev = pos === 0 ? " " : (charBefore(doc, pos) ?? " ");
    const curr = charAt(doc, pos) ?? " ";
    const currentLine = lineIndex(doc, pos);
    const lineStart = lineToChar(doc, currentLine);
    let newText = "";
    let from: number;
    let to: number;
    let localOffs: number;
    const idx = lastNonWhitespace(doc.sliceString(lineStart, pos));
    if (idx !== null) {
      const lastCh = charAt(doc, lineStart + idx)!;
      const firstTrailing = Math.min(Math.max(lineStart + idx + lastCh.length, lastPos), pos);
      lastPos = pos;
      const indent = indentForNewline(cx, doc, currentLine);
      const pair = pairs?.get(prev);
      const onAutoPair = !!pair && pair.open === prev && pair.close === curr;
      if (onAutoPair) {
        newText += "\n" + indent + unit;
        localOffs = newText.length;
        newText += "\n" + indent;
      } else {
        newText += "\n" + indent;
        localOffs = newText.length;
      }
      charsDeleted = pos - firstTrailing;
      from = firstTrailing;
      to = pos;
      localOffs -= charsDeleted;
    } else {
      newText += "\n";
      from = lineStart;
      to = lineStart;
      localOffs = newText.length;
    }
    const newRange =
      range.cursor(doc) > range.anchor
        ? new Range(range.anchor + globalOffs, range.head + localOffs + globalOffs)
        : new Range(range.anchor + localOffs + globalOffs, range.head + localOffs + globalOffs);
    ranges.push(newRange);
    globalOffs += newText.length - charsDeleted;
    changes.push([from, to, newText]);
  }
  apply(cx, changeSetOf(doc, changes), new Selection(ranges, sel.primaryIndex));
}

function dedent(cx: Context, doc: Text, range: Range): [number, number] | null {
  const pos = range.cursor(doc);
  const lineStart = lineToChar(doc, lineIndex(doc, pos));
  const fragment = doc.sliceString(lineStart, pos);
  if (fragment === "" || ![...fragment].every((c) => c === " " || c === "\t")) return null;
  if (charBefore(doc, pos) === "\t") return [nthPrevGraphemeBoundary(doc, pos, 1), pos];
  const config = cx.editor.config;
  const width = [...fragment].reduce((sum, c) => sum + (c === "\t" ? config.tabWidth : 1), 0);
  const iw = indentWidth(config);
  let drop = width % iw;
  if (drop === 0) drop = iw;
  let start = pos;
  const chars = [...fragment].reverse();
  for (let i = 0; i < drop; i++) {
    if (chars[i] === " ") start -= 1;
    else break;
  }
  return [start, pos];
}

export function deleteCharBackward(cx: Context): void {
  const count = cx.count();
  const doc = docOf(cx);
  const pairs = autoPairsOf(cx);
  deleteByAndWithSelection(cx, (range) => {
    const pos = range.cursor(doc);
    if (pos === 0) return [[pos, pos], null];
    const d = dedent(cx, doc, range);
    if (d) return [d, null];
    if (pairs) {
      const hooked = hookDelete(doc, range, pairs);
      if (hooked) return hooked;
    }
    return [[nthPrevGraphemeBoundary(doc, pos, count), pos], null];
  });
}

export function deleteBySelectionInsertMode(
  cx: Context,
  f: (doc: Text, range: Range) => [number, number],
  direction: "forward" | "backward",
): void {
  const doc = docOf(cx);
  const sel = selOf(cx);
  const ranges: Range[] = [];
  let insertNewline = false;
  const deletions: [number, number][] = [];
  for (const r of sel.ranges) {
    const [start, end] = f(doc, r);
    if (direction === "forward") {
      let range = r;
      if (range.head > range.anchor) {
        insertNewline = insertNewline || end === doc.length;
        range = new Range(range.anchor, Math.min(range.head + 1, doc.length));
      }
      ranges.push(range);
    }
    deletions.push([start, end]);
  }
  let changes = deleteChanges(doc, deletions);
  if (insertNewline) {
    const newDocLen = changes.newLength;
    changes = changes.compose(changeSetOf(changes.apply(doc), [[newDocLen, newDocLen, "\n"]]));
  }
  if (direction === "forward") {
    const preset = new Selection(ranges, sel.primaryIndex);
    const value = { selection: preset };
    const mapped = value.selection.map(changes);
    apply(cx, changes, mapped);
  } else {
    apply(cx, changes);
  }
}

function excludeCursor(doc: Text, range: Range, cursor: Range): Range {
  if (range.to() === cursor.to() && doc.length !== cursor.to()) {
    return new Range(range.from(), prevGraphemeBoundary(doc, cursor.to()));
  }
  return range;
}

export const insertCommands: Record<string, CommandFn> = {
  __insert_char: (cx, ch) => {
    if (ch !== undefined) insertChar(cx, ch);
  },
  insert_tab: (cx) => insertTabImpl(cx, 1),
  smart_tab: smartTab,
  insert_newline: insertNewline,
  delete_char_backward: deleteCharBackward,
  delete_char_forward: (cx) => {
    const count = cx.count();
    deleteBySelectionInsertMode(
      cx,
      (doc, range) => {
        const pos = range.cursor(doc);
        return [pos, nthNextGraphemeBoundary(doc, pos, count)];
      },
      "forward",
    );
  },
  delete_word_backward: (cx) => {
    const count = cx.count();
    deleteBySelectionInsertMode(
      cx,
      (doc, range) => {
        const anchor = wordMove(doc, range, count, "prevWordStart").from();
        const next = new Range(anchor, range.cursor(doc));
        const r = excludeCursor(doc, next, range);
        return [r.from(), r.to()];
      },
      "backward",
    );
  },
  delete_word_forward: (cx) => {
    const count = cx.count();
    deleteBySelectionInsertMode(
      cx,
      (doc, range) => [range.cursor(doc), wordMove(doc, range, count, "nextWordEnd").to()],
      "forward",
    );
  },
  kill_to_line_start: (cx) => {
    deleteBySelectionInsertMode(
      cx,
      (doc, range) => {
        const line = lineIndex(doc, range.cursor(doc));
        const firstChar = lineToChar(doc, line);
        const anchor = range.cursor(doc);
        let head: number;
        if (anchor === firstChar && line !== 0) head = lineEndCharIndex(doc, line - 1);
        else {
          const offset = firstNonWhitespaceChar(doc, line);
          if (offset !== null && firstChar + offset < anchor) head = firstChar + offset;
          else head = firstChar;
        }
        return [head, anchor];
      },
      "backward",
    );
  },
  kill_to_line_end: (cx) => {
    deleteBySelectionInsertMode(
      cx,
      (doc, range) => {
        const line = lineIndex(doc, range.cursor(doc));
        const lineEnd = lineEndCharIndex(doc, line);
        const pos = range.cursor(doc);
        if (pos === lineEnd) return [pos, lineToChar(doc, line + 1)];
        return [pos, lineEnd];
      },
      "forward",
    );
  },
  commit_undo_checkpoint: (cx) => commitHistoryNow(cx.host),
  insert_char_interactive: (cx) => {
    const mode = modeOf(cx);
    cx.editor.runStatic(cx, "insert_mode");
    insertSelectionInteractive(cx, mode);
  },
  append_char_interactive: (cx) => {
    const mode = modeOf(cx);
    cx.editor.runStatic(cx, "append_mode");
    insertSelectionInteractive(cx, mode);
  },
};

function insertSelectionInteractive(cx: Context, oldMode: "normal" | "insert" | "select"): void {
  const count = cx.count();
  cx.onNextKey((cx, key) => {
    if (key === "ret") {
      if (count !== 1) {
        cx.editor.setError("inserting multiple newlines not yet supported");
        return;
      }
      insertNewline(cx);
    } else if (key === "tab") {
      insertTabImpl(cx, count);
    } else {
      const ch = cx.editor.keyChar(key);
      if (ch !== null) for (let i = 0; i < count; i++) insertChar(cx, ch);
    }
    setModeOnly(cx, oldMode);
  });
}

export { setSel, nextGraphemeBoundary };
