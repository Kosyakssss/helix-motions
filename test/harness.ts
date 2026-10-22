import { Text } from "@codemirror/state";
import { commitHistoryNow } from "../src/commands/jumps";
import { HeadlessHost } from "../src/core/host";
import { HelixEditor } from "../src/core/editor";
import { buildKeymaps } from "../src/keymap";
import { helixField, historyField, setHelix, syncNativeSelection, toNative, helixOwned } from "../src/state";
import { defaultConfig, type Config } from "../src/config";
import { print, plain } from "../src/core/markup";

export interface RunResult {
  text?: string;
  ranges?: [number, number][];
  primary?: number;
  out: string;
  mode: string;
  register: string[] | null;
  error?: string;
}

export function makeEditor(config?: Partial<Config>) {
  return new HelixEditor(buildKeymaps(), { ...defaultConfig(), ...config });
}

export function makeHost(markup: string) {
  const { text, selection } = print(markup);
  const host = new HeadlessHost("\n", [helixField, historyField, syncNativeSelection]);
  const value = host.state.field(helixField);
  const next = { ...value, selection };
  host.dispatch({
    changes: { from: 0, to: 1, insert: text },
    selection: toNative(next, Text.of(text.split("\n"))),
    effects: setHelix.of(next),
    annotations: helixOwned.of(true),
  });
  commitHistoryNow(host);
  return host;
}

export function run(markup: string, keys: string, editor = makeEditor()): RunResult {
  const host = makeHost(markup);
  host.onChanges = (changes) => editor.docChanged(host, changes);
  try {
    editor.feedKeys(host, keys);
  } catch (err) {
    return { out: "", mode: "", register: null, error: String((err as Error).stack ?? err) };
  }
  const value = host.state.field(helixField);
  const text = host.state.doc.toString();
  const toChar = (pos: number) => [...text.slice(0, pos)].length;
  return {
    text,
    ranges: value.selection.ranges.map((r) => [toChar(r.anchor), toChar(r.head)] as [number, number]),
    primary: value.selection.primaryIndex,
    out: plain(text, value.selection),
    mode: value.mode,
    register: editor.registers.read('"', editor.registerEnv(host)),
  };
}
