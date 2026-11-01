import { Transaction } from "@codemirror/state";
import { helixField } from "helix-cm6";

export function isMarkupSnap(tr: Transaction): boolean {
  if (tr.docChanged || !tr.selection || tr.scrollIntoView || tr.effects.length > 0) return false;
  if (tr.annotation(Transaction.userEvent) !== undefined) return false;
  if (tr.startState.field(helixField).mode === "insert") return false;
  const before = tr.startState.selection.ranges;
  const after = tr.newSelection.ranges;
  if (before.length !== after.length) return false;
  const doc = tr.startState.doc;
  return before.every((r, i) => {
    const n = after[i]!;
    return doc.lineAt(r.anchor).number === doc.lineAt(n.anchor).number && doc.lineAt(r.head).number === doc.lineAt(n.head).number;
  });
}
