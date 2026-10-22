import type { ChangeDesc, Text } from "@codemirror/state";
import {
  ensureGraphemeBoundaryNext,
  ensureGraphemeBoundaryPrev,
  nextGraphemeBoundary,
  prevGraphemeBoundary,
} from "./graphemes";
import { mapPos } from "./core/mapping";

export type Direction = "forward" | "backward";

export class Range {
  constructor(
    readonly anchor: number,
    readonly head: number,
    readonly goalColumn?: number,
    readonly oldVisual?: readonly [number, number],
  ) {}

  static point(head: number): Range {
    return new Range(head, head);
  }

  from(): number {
    return Math.min(this.anchor, this.head);
  }

  to(): number {
    return Math.max(this.anchor, this.head);
  }

  isEmpty(): boolean {
    return this.anchor === this.head;
  }

  direction(): Direction {
    return this.head < this.anchor ? "backward" : "forward";
  }

  flip(): Range {
    return new Range(this.head, this.anchor, this.goalColumn, this.oldVisual);
  }

  withDirection(direction: Direction): Range {
    return this.direction() === direction ? this : this.flip();
  }

  withGoal(goalColumn: number | undefined): Range {
    return new Range(this.anchor, this.head, goalColumn, this.oldVisual);
  }

  withOldVisual(oldVisual: readonly [number, number] | undefined): Range {
    return new Range(this.anchor, this.head, this.goalColumn, oldVisual);
  }

  eq(other: Range): boolean {
    return this.anchor === other.anchor && this.head === other.head;
  }

  overlaps(other: Range): boolean {
    return this.from() === other.from() || (this.to() > other.from() && other.to() > this.from());
  }

  merge(other: Range): Range {
    if (this.anchor > this.head && other.anchor > other.head) {
      return new Range(Math.max(this.anchor, other.anchor), Math.min(this.head, other.head));
    }
    return new Range(Math.min(this.from(), other.from()), Math.max(this.to(), other.to()));
  }

  map(changes: ChangeDesc): Range {
    if (changes.empty) return this;
    if (this.anchor === this.head) {
      const pos = mapPos(changes, this.anchor, "afterSticky");
      return new Range(pos, pos);
    }
    if (this.anchor < this.head) {
      return new Range(mapPos(changes, this.anchor, "afterSticky"), mapPos(changes, this.head, "beforeSticky"));
    }
    return new Range(mapPos(changes, this.anchor, "beforeSticky"), mapPos(changes, this.head, "afterSticky"));
  }

  graphemeAligned(doc: Text): Range {
    let anchor: number;
    let head: number;
    if (this.anchor === this.head) {
      anchor = head = ensureGraphemeBoundaryPrev(doc, this.anchor);
    } else if (this.anchor < this.head) {
      anchor = ensureGraphemeBoundaryPrev(doc, this.anchor);
      head = ensureGraphemeBoundaryNext(doc, this.head);
    } else {
      anchor = ensureGraphemeBoundaryNext(doc, this.anchor);
      head = ensureGraphemeBoundaryPrev(doc, this.head);
    }
    const keep = anchor === this.anchor;
    return new Range(anchor, head, keep ? this.goalColumn : undefined, keep ? this.oldVisual : undefined);
  }

  minWidth1(doc: Text): Range {
    if (this.anchor !== this.head) return this;
    return new Range(this.anchor, nextGraphemeBoundary(doc, this.head), this.goalColumn, this.oldVisual);
  }

  cursor(doc: Text): number {
    return this.head > this.anchor ? prevGraphemeBoundary(doc, this.head) : this.head;
  }

  putCursor(doc: Text, pos: number, extend: boolean): Range {
    if (!extend) return Range.point(pos);
    let anchor = this.anchor;
    if (this.head >= this.anchor && pos < this.anchor) {
      anchor = nextGraphemeBoundary(doc, this.anchor);
    } else if (this.head < this.anchor && pos >= this.anchor) {
      anchor = prevGraphemeBoundary(doc, this.anchor);
    }
    return anchor <= pos
      ? new Range(anchor, nextGraphemeBoundary(doc, pos))
      : new Range(anchor, pos);
  }
}

export class Selection {
  readonly ranges: readonly Range[];
  readonly primaryIndex: number;

  constructor(ranges: readonly Range[], primaryIndex: number) {
    const normalized = normalize(ranges, primaryIndex);
    this.ranges = normalized.ranges;
    this.primaryIndex = normalized.primaryIndex;
  }

  static single(anchor: number, head: number): Selection {
    return new Selection([new Range(anchor, head)], 0);
  }

  primary(): Range {
    return this.ranges[this.primaryIndex]!;
  }

  transform(f: (range: Range, index: number) => Range): Selection {
    return new Selection(this.ranges.map(f), this.primaryIndex);
  }

  map(changes: ChangeDesc): Selection {
    if (changes.empty) return this;
    return this.transform((range) => range.map(changes));
  }

  ensureInvariants(doc: Text): Selection {
    return this.transform((range) => range.minWidth1(doc).graphemeAligned(doc));
  }

  eq(other: Selection): boolean {
    return (
      this.primaryIndex === other.primaryIndex &&
      this.ranges.length === other.ranges.length &&
      this.ranges.every((range, i) => range.eq(other.ranges[i]!))
    );
  }
}

function normalize(
  input: readonly Range[],
  primaryIndex: number,
): { ranges: Range[]; primaryIndex: number } {
  if (input.length < 2) return { ranges: [...input], primaryIndex: 0 };
  let primary = input[primaryIndex]!;
  const sorted = [...input].sort((a, b) => a.from() - b.from());
  const ranges: Range[] = [];
  for (const range of sorted) {
    const prev = ranges[ranges.length - 1];
    if (prev && prev.overlaps(range)) {
      const merged = range.merge(prev);
      if (prev === primary || range === primary) primary = merged;
      ranges[ranges.length - 1] = merged;
    } else {
      ranges.push(range);
    }
  }
  return { ranges, primaryIndex: Math.max(0, ranges.indexOf(primary)) };
}
