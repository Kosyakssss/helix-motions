import {
  EditorSelection,
  EditorState,
  type Extension,
  type Text,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { helixField, helixOwned, setHelix, toNative, type HelixState, type Mode } from "../state";
import type { Selection } from "../selection";

export interface Host {
  readonly state: EditorState;
  dispatch(...specs: TransactionSpec[]): void;
  readonly view: EditorView | null;
  readonly id: string;
  readonly name: string;
  readonly paneId: string;
}

export class HeadlessHost implements Host {
  state: EditorState;
  readonly view = null;
  readonly name: string;
  readonly paneId = "pane";
  constructor(
    doc: string,
    extensions: Extension,
    readonly id: string = "headless",
  ) {
    this.state = EditorState.create({ doc, extensions, selection: EditorSelection.cursor(0) });
    this.name = "[scratch]";
  }
  onChanges: ((changes: import("@codemirror/state").ChangeSet) => void) | null = null;
  dispatch(...specs: TransactionSpec[]): void {
    const tr = this.state.update(...specs);
    this.state = tr.state;
    if (tr.docChanged) this.onChanges?.(tr.changes);
  }
}

export function helix(host: Host): HelixState {
  return host.state.field(helixField);
}

export function mode(host: Host): Mode {
  return helix(host).mode;
}

export function doc(host: Host): Text {
  return host.state.doc;
}

export function selection(host: Host): Selection {
  return helix(host).selection;
}

export function setSelection(host: Host, sel: Selection, extra: TransactionSpec = {}): void {
  const value = helix(host);
  const next: HelixState = { ...value, selection: sel.ensureInvariants(host.state.doc) };
  host.dispatch({
    ...extra,
    selection: toNative(next, host.state.doc),
    effects: setHelix.of({ selection: next.selection }),
    annotations: helixOwned.of(true),
    scrollIntoView: extra.scrollIntoView ?? true,
  });
}

export function setMode(host: Host, mode: Mode, sel?: Selection, extra: Partial<HelixState> = {}): void {
  const value = helix(host);
  const next: HelixState = {
    ...value,
    ...extra,
    mode,
    selection: (sel ?? value.selection).ensureInvariants(host.state.doc),
  };
  host.dispatch({
    selection: toNative(next, host.state.doc),
    effects: setHelix.of(next),
    annotations: helixOwned.of(true),
    scrollIntoView: true,
  });
}

export function patchHelix(host: Host, patch: Partial<HelixState>): void {
  host.dispatch({ effects: setHelix.of(patch), annotations: helixOwned.of(true) });
}
