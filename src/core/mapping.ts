import type { ChangeDesc, ChangeSet } from "@codemirror/state";
import { charIsWord } from "./text";

export type Assoc = "before" | "after" | "beforeWord" | "afterWord" | "beforeSticky" | "afterSticky";

interface Change {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
  text: string | null;
}

const cache = new WeakMap<ChangeDesc, Change[]>();

function changesOf(desc: ChangeDesc): Change[] {
  let list = cache.get(desc);
  if (list) return list;
  list = [];
  const out = list;
  const set = desc as ChangeSet;
  if (typeof set.iterChanges === "function") {
    set.iterChanges((fromA, toA, fromB, toB, inserted) => {
      out.push({ fromA, toA, fromB, toB, text: inserted.toString() });
    });
  } else {
    desc.iterChangedRanges((fromA, toA, fromB, toB) => {
      out.push({ fromA, toA, fromB, toB, text: null });
    });
  }
  cache.set(desc, list);
  return list;
}

function insertOffset(assoc: Assoc, text: string | null, len: number): number {
  switch (assoc) {
    case "after":
    case "afterSticky":
      return len;
    case "before":
    case "beforeSticky":
      return 0;
    case "afterWord": {
      if (text === null) return len;
      let n = 0;
      for (const ch of text) {
        if (!charIsWord(ch)) break;
        n += ch.length;
      }
      return n;
    }
    case "beforeWord": {
      if (text === null) return 0;
      const chars = [...text];
      let n = 0;
      for (let i = chars.length - 1; i >= 0; i--) {
        if (!charIsWord(chars[i]!)) break;
        n += chars[i]!.length;
      }
      return len - n;
    }
  }
}

function sticky(assoc: Assoc): boolean {
  return assoc === "beforeSticky" || assoc === "afterSticky";
}

function stayAtGaps(assoc: Assoc): boolean {
  return assoc !== "beforeWord" && assoc !== "afterWord";
}

export function mapPos(desc: ChangeDesc, pos: number, assoc: Assoc): number {
  if (desc.empty) return pos;
  let diff = 0;
  for (const c of changesOf(desc)) {
    if (pos < c.fromA) return pos + diff;
    const deleted = c.toA - c.fromA;
    const inserted = c.toB - c.fromB;
    if (deleted === 0) {
      if (pos === c.fromA) return c.fromB + insertOffset(assoc, c.text, inserted);
    } else if (pos < c.toA) {
      if (inserted === 0) return c.fromB;
      if (pos === c.fromA && stayAtGaps(assoc)) return c.fromB;
      const ins = insertOffset(assoc, c.text, inserted);
      if (deleted === ins && sticky(assoc)) return c.fromB + (pos - c.fromA);
      return c.fromB + ins;
    }
    diff = c.toB - c.toA;
  }
  return pos + diff;
}
