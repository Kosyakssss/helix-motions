import type { ChangeDesc } from "@codemirror/state";
import type { Context } from "../core/editor";
import type { Host } from "../core/host";
import { commitHistory, historyApply } from "../history";
import type { Selection } from "../selection";
import { helixField, historyField } from "../state";

export interface Jump {
  docId: string;
  selection: Selection;
}

const CAPACITY = 30;

export class JumpList {
  jumps: Jump[] = [];
  current = 0;

  constructor(initial: Jump) {
    this.jumps.push(initial);
  }

  private pushImpl(jump: Jump): number {
    let removed = 0;
    this.jumps.length = Math.min(this.jumps.length, this.current);
    const back = this.jumps[this.jumps.length - 1];
    if (!back || back.docId !== jump.docId || !back.selection.eq(jump.selection)) {
      while (this.jumps.length >= CAPACITY) {
        this.jumps.shift();
        removed++;
      }
      this.jumps.push(jump);
      this.current = this.jumps.length;
    }
    return removed;
  }

  push(jump: Jump): void {
    this.pushImpl(jump);
  }

  forward(count: number): Jump | null {
    if (this.current + count < this.jumps.length) {
      this.current += count;
      return this.jumps[this.current] ?? null;
    }
    return null;
  }

  backward(here: Jump, count: number): Jump | null {
    let current = this.current - count;
    if (current < 0) return null;
    if (this.current === this.jumps.length) {
      const removed = this.pushImpl(here);
      current = Math.max(0, current - removed);
    }
    this.current = current;
    const entry = this.jumps[this.current];
    if (!entry) return null;
    if (entry.docId === here.docId && entry.selection.eq(here.selection)) {
      if (this.current === 0) return null;
      this.current -= 1;
    }
    return this.jumps[this.current] ?? null;
  }

  remove(docId: string): void {
    const before = this.jumps.slice(0, this.current).filter((j) => j.docId === docId).length;
    this.jumps = this.jumps.filter((j) => j.docId !== docId);
    this.current = Math.min(Math.max(0, this.current - before), this.jumps.length);
  }

  map(docId: string, changes: ChangeDesc): void {
    for (const jump of this.jumps) {
      if (jump.docId === docId) jump.selection = jump.selection.map(changes);
    }
  }
}

export function commitHistoryNow(host: Host): void {
  const pending = host.state.field(historyField).pending;
  if (!pending) return;
  host.dispatch({
    effects: commitHistory.of({ selection: host.state.field(helixField).selection, timestamp: Date.now() }),
  });
}

export function jumplistFor(cx: Context): JumpList {
  return cx.editor.jumplist(cx.host);
}

export function pushJump(cx: Context): void {
  commitHistoryNow(cx.host);
  jumplistFor(cx).push({ docId: cx.host.id, selection: cx.host.state.field(helixField).selection });
}

export { historyApply };
