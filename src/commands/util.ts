import { ChangeSet, Transaction, type Text, type TransactionSpec } from "@codemirror/state";
import type { Context } from "../core/editor";
import { helix, type Host } from "../core/host";
import { Range, Selection } from "../selection";
import { helixField, helixOwned, setHelix, toNative, type HelixState, type Mode } from "../state";
import { mapPos } from "../core/mapping";
import { lineEnd, lineIndex, lineStart } from "../core/text";
import { prevGraphemeBoundary } from "../graphemes";

export type Change = [number, number, string | null];

export function docOf(cx: Context): Text {
  return cx.host.state.doc;
}

export function selOf(cx: Context): Selection {
  return helix(cx.host).selection;
}

export function modeOf(cx: Context): Mode {
  return helix(cx.host).mode;
}

export function changeSetOf(doc: Text, changes: Change[]): ChangeSet {
  const specs = changes
    .filter(([from, to, text]) => !(text === null && from === to) && !(text === "" && from === to))
    .map(([from, to, text]) => ({ from, to, insert: text ?? "" }));
  return ChangeSet.of(specs, doc.length);
}

export function setSel(cx: Context, sel: Selection, extra: TransactionSpec = {}): void {
  dispatchHelix(cx.host, { selection: sel }, extra);
}

export function setModeOnly(cx: Context, mode: Mode): void {
  dispatchHelix(cx.host, { mode });
}

export function dispatchHelix(host: Host, patch: Partial<HelixState>, extra: TransactionSpec = {}): void {
  const value = host.state.field(helixField);
  const doc = host.state.doc;
  const next: HelixState = {
    ...value,
    ...patch,
    selection: (patch.selection ?? value.selection).ensureInvariants(doc),
  };
  host.dispatch({
    ...extra,
    selection: toNative(next, doc),
    effects: [setHelix.of(next), ...asArray(extra.effects)],
    annotations: [helixOwned.of(true), ...asArray(extra.annotations)],
    scrollIntoView: extra.scrollIntoView ?? true,
  });
}

function asArray<T>(v: T | readonly T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? [...(v as T[])] : [v as T];
}

export function apply(
  cx: Context,
  changes: ChangeSet,
  selection?: Selection | null,
  extra: TransactionSpec = {},
  patch: Partial<HelixState> = {},
): void {
  applyToHost(cx.host, changes, selection, extra, patch);
}

export function applyToHost(
  host: Host,
  changes: ChangeSet,
  selection?: Selection | null,
  extra: TransactionSpec = {},
  patch: Partial<HelixState> = {},
): void {
  const value = host.state.field(helixField);
  const newDoc = changes.apply(host.state.doc);
  const mapped = value.selection.map(changes);
  const sel = (selection ?? mapped).ensureInvariants(newDoc);
  const next: HelixState = { ...value, ...patch, selection: sel };
  host.dispatch({
    ...extra,
    changes,
    selection: toNative(next, newDoc),
    effects: [setHelix.of(next), ...asArray(extra.effects)],
    annotations: [
      helixOwned.of(true),
      Transaction.userEvent.of("input.helix"),
      ...asArray(extra.annotations),
    ],
    scrollIntoView: extra.scrollIntoView ?? true,
  });
}

export function changeBySelection(cx: Context, f: (range: Range) => Change, selection?: Selection): void {
  const doc = docOf(cx);
  const sel = selOf(cx);
  apply(cx, changeSetOf(doc, sel.ranges.map(f)), selection);
}

export function changeByAndWithSelection(cx: Context, f: (range: Range) => [Change, Range | null]): void {
  const doc = docOf(cx);
  const sel = selOf(cx);
  const endRanges: Range[] = [];
  const changes: Change[] = [];
  let offset = 0;
  for (const range of sel.ranges) {
    const [[from, to, text], endRange] = f(range);
    let changeSize = to - from;
    changeSize = text !== null ? text.length - changeSize : -changeSize;
    let newRange: Range;
    if (endRange) newRange = endRange;
    else newRange = range.map(changeSetOf(doc, [[from, to, text]]));
    endRanges.push(new Range(newRange.anchor + offset, newRange.head + offset));
    offset += changeSize;
    changes.push([from, to, text]);
  }
  apply(cx, changeSetOf(doc, changes), new Selection(endRanges, sel.primaryIndex));
}

export function deleteChanges(doc: Text, deletions: [number, number][]): ChangeSet {
  const changes: Change[] = [];
  let last = 0;
  for (let [from, to] of deletions) {
    if (last > to) continue;
    if (last > from) from = last;
    changes.push([from, to, null]);
    last = to;
  }
  return changeSetOf(doc, changes);
}

export function deleteByAndWithSelection(cx: Context, f: (range: Range) => [[number, number], Range | null]): void {
  const doc = docOf(cx);
  const sel = selOf(cx);
  const endRanges: Range[] = [];
  const deletions: [number, number][] = [];
  let offset = 0;
  let last = 0;
  for (const range of sel.ranges) {
    const [[from, to], endRange] = f(range);
    const changeSize = last > from ? to - last : to - from;
    const newRange = endRange ?? range.map(changeSetOf(doc, [[from, to, null]]));
    endRanges.push(new Range(Math.max(0, newRange.anchor - offset), Math.max(0, newRange.head - offset)));
    offset += changeSize;
    last = to;
    deletions.push([from, to]);
  }
  apply(cx, deleteChanges(doc, deletions), new Selection(endRanges, sel.primaryIndex));
}

export function lineRange(doc: Text, range: Range): [number, number] {
  const from = range.from();
  const to = range.isEmpty() ? range.to() : Math.max(prevGraphemeBoundary(doc, range.to()), from);
  return [lineIndex(doc, from), lineIndex(doc, to)];
}

export function lineEndCharIndex(doc: Text, line: number): number {
  return lineEnd(doc, line);
}

export function lineToChar(doc: Text, line: number): number {
  return lineStart(doc, line);
}

export function firstNonWhitespaceChar(doc: Text, line: number): number | null {
  const text = doc.line(line + 1).text;
  let offset = 0;
  for (const ch of text) {
    if (!/^\p{White_Space}$/u.test(ch)) return offset;
    offset += ch.length;
  }
  if (line < doc.lines - 1) return null;
  return null;
}

export function exitSelectMode(cx: Context): void {
  if (modeOf(cx) === "select") setModeOnly(cx, "normal");
}

export function enterInsertMode(cx: Context): void {
  setModeOnly(cx, "insert");
}

export function fragments(doc: Text, sel: Selection): string[] {
  return sel.ranges.map((r) => doc.sliceString(r.from(), r.to()));
}

export function mapPosAfter(changes: ChangeSet, pos: number): number {
  return mapPos(changes, pos, "after");
}
