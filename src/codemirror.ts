import type { Extension, TransactionSpec } from "@codemirror/state";
import { EditorView, drawSelection } from "@codemirror/view";
import { HelixEditor } from "./core/editor";
import type { Host } from "./core/host";
import { setRegexEngine } from "./core/regex";
import { loadConfig } from "./config-loader";
import { buildKeymaps } from "./keymap";
import { Registers } from "./registers";
import { SystemClipboard } from "./view/clipboard";
import { helixExtension, uiSignature } from "./view/view";
import { makeViewOps } from "./view/viewops";
import { loadRegex } from "./view/wasm";

export interface HelixOptions {
  config?: string;
}

export function helix(options: HelixOptions = {}): Extension {
  const loaded = loadConfig(options.config ?? null);
  const editor = new HelixEditor(buildKeymaps(loaded.keys), loaded.config);
  editor.visualLines = true;
  editor.registers = new Registers(new SystemClipboard());
  editor.viewOps = makeViewOps(() => editor.config.scrolloff);
  void loadRegex()
    .then((engine) => setRegexEngine(engine))
    .catch(() => editor.setError("the regex engine failed to load"));

  const hosts = new WeakMap<EditorView, Host>();
  let count = 0;
  const hostFor = (view: EditorView): Host => {
    let host = hosts.get(view);
    if (!host) {
      const id = `editor-${++count}`;
      host = {
        get state() {
          return view.state;
        },
        dispatch: (...specs: TransactionSpec[]) => view.dispatch(...specs),
        view,
        id,
        name: "[scratch]",
        paneId: id,
      };
      hosts.set(view, host);
    }
    return host;
  };

  let active: EditorView | null = null;
  let signature = "";
  const refresh = (host: Host) => {
    const next = uiSignature(editor, host);
    if (next === signature) return;
    signature = next;
    host.view?.dispatch({});
  };
  editor.ui = {
    notify: () =>
      queueMicrotask(() => {
        if (active?.dom.isConnected) refresh(hostFor(active));
      }),
    render: refresh,
    promptChanged: refresh,
    jumpLabels: refresh,
  };

  const nativeUndo = EditorView.domEventHandlers({
    beforeinput: (event) => {
      if (event.inputType !== "historyUndo" && event.inputType !== "historyRedo") return false;
      event.preventDefault();
      return true;
    },
  });

  const extension = helixExtension({
    editor,
    hostFor,
    insertKeysHelix: () => true,
    physicalKeys: () => false,
    suggestTakes: () => false,
    onFocusChange: (view) => {
      active = view;
    },
    onRender: (view) => {
      if (view.hasFocus) active = view;
    },
    onChanges: (view, changes) => editor.docChanged(hostFor(view), changes),
    onDocTransaction: () => undefined,
    onViewOpen: () => undefined,
    onViewClose: () => undefined,
  });
  return [extension, drawSelection(), nativeUndo];
}
