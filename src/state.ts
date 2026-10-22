import {
  Annotation,
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  type Text,
  type Transaction,
} from "@codemirror/state";
import { Range, Selection } from "./selection";
import { makeHistoryField } from "./history";

export type Mode = "normal" | "insert" | "select";

export interface HelixState {
  readonly mode: Mode;
  readonly selection: Selection;
  readonly restoreCursor: boolean;
}

export const setHelix = StateEffect.define<Partial<HelixState>>();

export const helixOwned = Annotation.define<boolean>();

export const helixField = StateField.define<HelixState>({
  create(state) {
    return {
      mode: "normal",
      selection: fromNative(state.selection, "normal", null, state.doc).ensureInvariants(state.doc),
      restoreCursor: false,
    };
  },
  update(value, tr) {
    return derive(value, tr);
  },
});

export function derive(value: HelixState, tr: Transaction): HelixState {
  let next = value;
  let explicit = false;
  for (const effect of tr.effects) {
    if (effect.is(setHelix)) {
      next = { ...next, ...effect.value };
      if (effect.value.selection) explicit = true;
    }
  }
  if (explicit) return next;
  let selection = next.selection.map(tr.changes);
  if (tr.selection && !tr.annotation(helixOwned)) {
    selection = fromNative(tr.newSelection, next.mode, selection, tr.newDoc);
  }
  selection = selection.ensureInvariants(tr.newDoc);
  if (selection === next.selection && next === value) return value;
  return { ...next, selection };
}

export function fromNative(
  native: EditorSelection,
  mode: Mode,
  mapped: Selection | null,
  doc: Text,
): Selection {
  const ranges = native.ranges.map((r) => {
    if (!r.empty) return new Range(r.anchor, r.head, r.goalColumn);
    if (mode === "insert" && mapped) {
      const kept = mapped.ranges.find((m) => m.cursor(doc) === r.head);
      if (kept) return kept;
    }
    return new Range(r.head, r.head, r.goalColumn);
  });
  return new Selection(ranges, native.mainIndex);
}

export function toNative(value: HelixState, doc: Text): EditorSelection {
  const ranges = value.selection.ranges.map((r) =>
    value.mode === "insert"
      ? EditorSelection.cursor(r.cursor(doc), 0, undefined, r.goalColumn)
      : EditorSelection.range(r.anchor, r.head, r.goalColumn),
  );
  return EditorSelection.create(ranges, value.selection.primaryIndex);
}

export const syncNativeSelection = EditorState.transactionFilter.of((tr) => {
  if (tr.annotation(helixOwned)) return tr;
  if (!tr.docChanged && !tr.selection) return tr;
  const value = derive(tr.startState.field(helixField), tr);
  const native = toNative(value, tr.newDoc);
  if (native.eq(tr.newSelection)) return tr;
  return [
    tr,
    {
      selection: native,
      effects: setHelix.of({ selection: value.selection }),
      annotations: helixOwned.of(true),
      sequential: true,
    },
  ];
});

export const historyField = makeHistoryField((state) => state.field(helixField).selection);
