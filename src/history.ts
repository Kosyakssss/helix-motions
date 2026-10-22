import { ChangeSet, StateEffect, StateField, type Text, type Transaction } from "@codemirror/state";
import type { Selection } from "./selection";

export interface Revision {
  parent: number;
  lastChild: number | null;
  changes: ChangeSet;
  inversion: ChangeSet;
  selectionAfter: Selection | null;
  selectionBefore: Selection | null;
  timestamp: number;
}

export interface Pending {
  changes: ChangeSet;
  oldDoc: Text;
  oldSelection: Selection;
}

export interface HistoryState {
  revisions: Revision[];
  current: number;
  pending: Pending | null;
}

export const commitHistory = StateEffect.define<{ selection: Selection; timestamp: number }>();
export const setHistoryCurrent = StateEffect.define<number>();
export const historyApply = StateEffect.define<null>();
export const startPending = StateEffect.define<Selection>();

function rootRevision(doc: Text): Revision {
  const empty = ChangeSet.empty(doc.length);
  return {
    parent: 0,
    lastChild: null,
    changes: empty,
    inversion: empty,
    selectionAfter: null,
    selectionBefore: null,
    timestamp: Date.now(),
  };
}

export function createHistory(doc: Text): HistoryState {
  return { revisions: [rootRevision(doc)], current: 0, pending: null };
}

export function makeHistoryField(selectionOf: (state: Transaction["startState"]) => Selection) {
  return StateField.define<HistoryState>({
    create(state) {
      return createHistory(state.doc);
    },
    update(value, tr) {
      let next = value;
      let applying = false;
      for (const e of tr.effects) {
        if (e.is(historyApply)) applying = true;
        if (e.is(setHistoryCurrent)) next = { ...next, current: e.value };
      }
      if (tr.docChanged && !applying) {
        const pending = next.pending
          ? { ...next.pending, changes: next.pending.changes.compose(tr.changes) }
          : { changes: tr.changes, oldDoc: tr.startState.doc, oldSelection: selectionOf(tr.startState) };
        next = { ...next, pending };
      }
      for (const e of tr.effects) {
        if (e.is(commitHistory)) next = commit(next, e.value.selection, e.value.timestamp);
      }
      return next;
    },
  });
}

function commit(value: HistoryState, selection: Selection, timestamp: number): HistoryState {
  const pending = value.pending;
  if (!pending || pending.changes.empty) return { ...value, pending: null };
  const revisions = value.revisions.slice();
  const index = revisions.length;
  revisions[value.current] = { ...revisions[value.current]!, lastChild: index };
  revisions.push({
    parent: value.current,
    lastChild: null,
    changes: pending.changes,
    inversion: pending.changes.invert(pending.oldDoc),
    selectionAfter: selection,
    selectionBefore: pending.oldSelection,
    timestamp,
  });
  return { revisions, current: index, pending: null };
}

export interface Step {
  changes: ChangeSet;
  selection: Selection | null;
}

export function undoStep(value: HistoryState): { current: number; step: Step } | null {
  if (value.current === 0) return null;
  const rev = value.revisions[value.current]!;
  return { current: rev.parent, step: { changes: rev.inversion, selection: rev.selectionBefore } };
}

export function redoStep(value: HistoryState): { current: number; step: Step } | null {
  const rev = value.revisions[value.current]!;
  if (rev.lastChild === null) return null;
  const child = value.revisions[rev.lastChild]!;
  return { current: rev.lastChild, step: { changes: child.changes, selection: child.selectionAfter } };
}

function lowestCommonAncestor(value: HistoryState, a: number, b: number): number {
  const aPath = new Set<number>();
  const bPath = new Set<number>();
  for (;;) {
    aPath.add(a);
    bPath.add(b);
    if (aPath.has(b)) return b;
    if (bPath.has(a)) return a;
    a = value.revisions[a]!.parent;
    b = value.revisions[b]!.parent;
  }
}

function pathUp(value: HistoryState, n: number, a: number): number[] {
  const path: number[] = [];
  while (n !== a) {
    path.push(n);
    n = value.revisions[n]!.parent;
  }
  return path;
}

export function jumpTo(value: HistoryState, to: number): Step[] {
  const lca = lowestCommonAncestor(value, value.current, to);
  const up = pathUp(value, value.current, lca);
  const down = pathUp(value, to, lca);
  const steps: Step[] = up.map((n) => ({
    changes: value.revisions[n]!.inversion,
    selection: value.revisions[n]!.selectionBefore,
  }));
  for (const n of down.reverse()) {
    steps.push({ changes: value.revisions[n]!.changes, selection: value.revisions[n]!.selectionAfter });
  }
  return steps;
}

export type UndoKind = { kind: "steps"; n: number } | { kind: "time"; ms: number };

function jumpInstant(value: HistoryState, instant: number): number {
  const revs = value.revisions;
  let lo = 0;
  let hi = revs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (revs[mid]!.timestamp < instant) lo = mid + 1;
    else hi = mid;
  }
  if (lo < revs.length && revs[lo]!.timestamp === instant) return lo;
  if (lo === 0) return 0;
  if (lo === revs.length) return lo - 1;
  const before = instant - revs[lo - 1]!.timestamp;
  const after = revs[lo]!.timestamp - instant;
  return before < after ? lo - 1 : lo;
}

export function earlierTarget(value: HistoryState, uk: UndoKind): number {
  if (uk.kind === "steps") return Math.max(0, value.current - uk.n);
  const instant = value.revisions[value.current]!.timestamp - uk.ms;
  return jumpInstant(value, instant);
}

export function laterTarget(value: HistoryState, uk: UndoKind): number {
  if (uk.kind === "steps") return Math.min(value.revisions.length - 1, value.current + uk.n);
  const instant = value.revisions[value.current]!.timestamp + uk.ms;
  return jumpInstant(value, instant);
}

const TIME_UNITS: [string[], string, number][] = [
  [["seconds", "second", "sec", "s"], "seconds", 1],
  [["minutes", "minute", "min", "m"], "minutes", 60],
  [["hours", "hour", "hr", "h"], "hours", 3600],
  [["days", "day", "d"], "days", 86400],
];

export function parseUndoKind(input: string): UndoKind {
  const s = input.trim();
  if (s === "") return { kind: "steps", n: 1 };
  if (/^\d+$/.test(s)) return { kind: "steps", n: Number(s) };
  if (!/^(?:\d+\s*[a-z]+\s*)+$/.test(s)) {
    throw new Error("duration should be composed of positive integers followed by time units");
  }
  const specified = TIME_UNITS.map(() => false);
  let seconds = 0;
  for (const m of s.matchAll(/(\d+)\s*([a-z]+)/g)) {
    const idx = TIME_UNITS.findIndex(([forms]) => forms.includes(m[2]!));
    if (idx < 0) throw new Error(`incorrect time unit: ${m[2]}`);
    if (specified[idx]) throw new Error(`${TIME_UNITS[idx]![1]} specified more than once`);
    specified[idx] = true;
    seconds += Number(m[1]) * TIME_UNITS[idx]![2];
  }
  return { kind: "time", ms: seconds * 1000 };
}

export function lastEditPos(value: HistoryState): number | null {
  if (value.current === 0) return null;
  const rev = value.revisions[value.current]!;
  const primary = rev.selectionBefore?.primary();
  let found: [number, number] | null = null;
  let first: [number, number] | null = null;
  rev.changes.iterChanges((fromA, toA) => {
    if (!first) first = [fromA, toA];
    if (!found && primary) {
      const from = Math.min(fromA, toA);
      const to = Math.max(fromA, toA);
      if (from === primary.from() || (to > primary.from() && primary.to() > from)) found = [fromA, toA];
    }
  });
  const pick = found ?? first;
  if (!pick) return null;
  return rev.changes.mapPos((pick as [number, number])[1], 1);
}
