import { MarkdownView, Notice, Plugin, PluginSettingTab, Setting, editorInfoField, type App, type TFile } from "obsidian";
import type { EditorView } from "@codemirror/view";
import type { TransactionSpec } from "@codemirror/state";
import { HelixEditor, Context } from "./core/editor";
import type { Host } from "./core/host";
import { buildKeymaps } from "./keymap";
import { loadConfig } from "./config-loader";
import { defaultConfig, type Config } from "./config";
import { helixExtension, whitespaceCompartment } from "./obsidian/view";
import { highlightWhitespace, runScopeHandlers } from "@codemirror/view";
import { deleteCharBackward, insertNewlineAndIndent } from "@codemirror/commands";
import { makeWorkspace, leafId } from "./obsidian/workspace";
import { makeViewOps } from "./obsidian/viewops";
import { renderStatus } from "./obsidian/status";
import { commentTokensAt } from "./obsidian/comments";
import { ElectronClipboard } from "./obsidian/clipboard";
import { helixField } from "./state";
import { Registers } from "./registers";
import { commitHistoryNow } from "./commands/jumps";
import { print, plain } from "./core/markup";
import { setHelix, helixOwned, toNative } from "./state";

interface Settings {
  autoPairs: "helix" | "obsidian";
  insertKeys: "obsidian" | "helix";
}

const DEFAULT_SETTINGS: Settings = { autoPairs: "helix", insertKeys: "obsidian" };

export default class HelixMotionsPlugin extends Plugin {
  override settings: Settings = DEFAULT_SETTINGS;
  helix!: HelixEditor;
  hosts = new WeakMap<EditorView, Host>();
  statusEl!: HTMLElement;
  lastFileByLeaf = new Map<string, string[]>();
  lastModified: string[] = [];
  private activeView: EditorView | null = null;

  override async onload(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<Settings> | null) };
    const vault = this.app.vault as unknown as { getConfig(key: string): unknown };
    const plugins = (this.app as unknown as { plugins: { enabledPlugins: Set<string> } }).plugins;
    if (vault.getConfig("vimMode")) {
      new Notice("Helix Motions: turn off Settings → Editor → Vim key bindings, then reload the plugin.", 0);
      return;
    }
    if (plugins.enabledPlugins.has("vim-motions")) {
      new Notice("Helix Motions: turn off the Vim Motions plugin, then reload this plugin.", 0);
      return;
    }
    this.helix = new HelixEditor(buildKeymaps(), this.baseConfig());
    this.helix.visualLines = true;
    this.helix.continueLists = true;
    this.helix.helixAutoPairs = this.settings.autoPairs === "helix";
    this.helix.registers = new Registers(new ElectronClipboard());
    this.helix.workspace = makeWorkspace(this);
    this.helix.viewOps = makeViewOps(() => this.helix.config.scrolloff);
    this.helix.commentTokens = (host, pos) => commentTokensAt(host.state.doc, pos);
    this.helix.ui = {
      notify: () => this.refreshStatus(),
      render: (host) => this.refresh(host),
      promptChanged: (host) => this.refresh(host),
      jumpLabels: (host) => this.refresh(host),
    };
    this.helix.replayKeyHook = (host, key) => {
      if (this.settings.insertKeys === "helix" || !host.view) return false;
      const dom: Record<string, [string, boolean]> = {
        ret: ["Enter", false],
        tab: ["Tab", false],
        "S-tab": ["Tab", true],
        backspace: ["Backspace", false],
        "S-backspace": ["Backspace", true],
      };
      const spec = dom[key];
      if (!spec) return false;
      const event = new KeyboardEvent("keydown", { key: spec[0], code: spec[0], shiftKey: spec[1], bubbles: true, cancelable: true });
      if (runScopeHandlers(host.view, event, "editor")) return true;
      if (spec[0] === "Backspace") return deleteCharBackward(host.view);
      if (spec[0] === "Enter") return insertNewlineAndIndent(host.view);
      return false;
    };
    await this.reloadConfig();
    this.registerEditorExtension(
      helixExtension({
        editor: this.helix,
        hostFor: (view) => this.hostForView(view),
        insertKeysHelix: () => this.settings.insertKeys === "helix",
        suggestOpen: () => this.suggestOpen(),
        onFocusChange: (view) => {
          this.activeView = view;
          this.refreshStatus();
        },
        onRender: (view) => {
          if (view.hasFocus || this.activeView === view) {
            this.activeView = view;
            this.refreshStatus();
          }
        },
        onChanges: (view, changes) => {
          this.helix.docChanged(this.hostForView(view), changes);
        },
      }),
    );
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("hx-status");
    this.addSettingTab(new HelixSettingTab(this.app, this));
    this.addCommand({ id: "reload-config", name: "Reload config.toml", callback: () => void this.reloadConfig() });
    this.registerEvent(
      this.app.workspace.on("file-open", (file: TFile | null) => {
        const leaf = this.app.workspace.getMostRecentLeaf();
        if (!file || !leaf) return;
        const id = leafId(leaf);
        const list = this.lastFileByLeaf.get(id) ?? [];
        if (list[list.length - 1] !== file.path) list.push(file.path);
        if (list.length > 50) list.shift();
        this.lastFileByLeaf.set(id, list);
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        this.lastModified = this.lastModified.filter((p) => p !== file.path);
        this.lastModified.push(file.path);
      }),
    );
    this.registerEvent(
      (this.app.vault as unknown as { on(name: "raw", cb: (path: string) => void): import("obsidian").EventRef }).on("raw", (path) => {
        if (path === this.configPath()) void this.reloadConfig();
      }),
    );
  }

  api = {
    view: (): EditorView | null => {
      const md = this.app.workspace.getActiveViewOfType(MarkdownView);
      return md ? (md.editor as unknown as { cm: EditorView }).cm : null;
    },
    state: () => {
      const view = this.api.view();
      if (!view) return null;
      const value = view.state.field(helixField);
      const text = view.state.doc.toString();
      const toChar = (pos: number) => [...text.slice(0, pos)].length;
      return {
        text,
        ranges: value.selection.ranges.map((r) => [toChar(r.anchor), toChar(r.head)]),
        primary: value.selection.primaryIndex,
        markup: plain(text, value.selection),
        mode: value.mode,
        native: view.state.selection.ranges.map((r) => [r.anchor, r.head]),
        nativeMain: view.state.selection.mainIndex,
        status: this.helix.status,
        prompt: this.helix.activePrompt ? { label: this.helix.activePrompt.label, line: this.helix.activePrompt.line } : null,
        pending: this.helix.pendingDisplay(),
        focus: view.hasFocus,
        classes: view.dom.className,
      };
    },
    set: (markup: string) => {
      const view = this.api.view();
      if (!view) return false;
      const { text, selection } = print(markup);
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      const value = view.state.field(helixField);
      const next = { ...value, mode: "normal" as const, selection, restoreCursor: false };
      view.dispatch({ selection: toNative(next, view.state.doc), effects: setHelix.of(next), annotations: helixOwned.of(true) });
      commitHistoryNow(this.hostForView(view));
      this.helix.resetJumplists();
      this.helix.activePrompt = null;
      this.helix.onNextKeyState = null;
      this.helix.count = null;
      this.helix.keymaps.reset();
      this.helix.macroRecording = null;
      this.helix.macroReplaying = [];
      this.helix.lastMotion = null;
      this.helix.selectedRegister = null;
      this.helix.status = null;
      this.helix.lastInsert = { command: { kind: "static", name: "normal_mode" }, keys: [] };
      this.helix.registers = new Registers(this.helix.registers.clipboard);
      view.focus();
      return true;
    },
    useConfig: async (source: string | null) => {
      if (source === null) await this.reloadConfig();
      else {
        const loaded = loadConfig(source, this.baseConfig());
        this.helix.config = loaded.config;
        this.helix.keymaps = buildKeymaps(loaded.keys);
      }
      return true;
    },
    feed: (keys: string) => {
      const view = this.api.view();
      if (!view) return null;
      this.helix.feedKeys(this.hostForView(view), keys);
      return this.api.state();
    },
  };

  override onunload(): void {
    this.statusEl?.remove();
  }

  baseConfig(): Config {
    const config = defaultConfig();
    const vault = this.app.vault as unknown as { getConfig(key: string): unknown };
    const useTab = vault.getConfig("useTab") !== false;
    const tabSize = Number(vault.getConfig("tabSize") ?? 4) || 4;
    config.tabWidth = tabSize;
    config.indentStyle = useTab ? { kind: "tabs" } : { kind: "spaces", width: tabSize };
    return config;
  }

  configPath(): string {
    return `${this.app.vault.configDir}/config.toml`;
  }

  async reloadConfig(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const path = this.configPath();
    const source = (await adapter.exists(path)) ? await adapter.read(path) : null;
    const loaded = loadConfig(source, this.baseConfig());
    this.helix.config = loaded.config;
    this.helix.keymaps = buildKeymaps(loaded.keys);
    if (loaded.warnings.length > 0) {
      console.warn("Helix Motions config warnings:\n" + loaded.warnings.join("\n"));
      new Notice(`Helix Motions: ${loaded.warnings.length} config warning(s). See the developer console.`);
    }
    this.applyViewConfig();
    this.refreshStatus();
  }

  applyViewConfig(): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!(leaf.view instanceof MarkdownView)) return;
      const cm = (leaf.view.editor as unknown as { cm: EditorView }).cm;
      cm.dispatch({ effects: whitespaceCompartment.reconfigure(this.helix.config.whitespaceRender ? highlightWhitespace() : []) });
    });
  }

  hostForView(view: EditorView): Host {
    let host = this.hosts.get(view);
    if (!host) {
      host = {
        get state() {
          return view.state;
        },
        dispatch: (...specs: TransactionSpec[]) => view.dispatch(...specs),
        view,
        get id() {
          return view.state.field(editorInfoField, false)?.file?.path ?? "untitled";
        },
        get name() {
          return view.state.field(editorInfoField, false)?.file?.path ?? "[scratch]";
        },
        get paneId() {
          const info = view.state.field(editorInfoField, false) as unknown as { leaf?: { id?: string } } | undefined;
          return info?.leaf?.id ?? "pane";
        },
      };
      this.hosts.set(view, host);
    }
    return host;
  }

  viewFor(host: { view: EditorView | null }): MarkdownView | null {
    if (!host.view) return null;
    const info = host.view.state.field(editorInfoField, false);
    return info instanceof MarkdownView ? info : null;
  }

  async writeView(view: MarkdownView): Promise<void> {
    const config = this.helix.config;
    const editor = view.editor;
    let text = editor.getValue();
    const original = text;
    if (config.trimTrailingWhitespace) text = text.replace(/[ \t]+$/gm, "");
    if (config.trimFinalNewlines) text = text.replace(/\n+$/, "\n");
    if (config.insertFinalNewline && text.length > 0 && !text.endsWith("\n")) text += "\n";
    if (text !== original) {
      const cm = (editor as unknown as { cm: EditorView }).cm;
      const host = this.hostForView(cm);
      const from = 0;
      host.dispatch({ changes: { from, to: original.length, insert: text } });
    }
    await view.save();
  }

  suggestOpen(): boolean {
    const suggest = (this.app.workspace as unknown as { editorSuggest?: { currentSuggest?: unknown } }).editorSuggest;
    return !!suggest?.currentSuggest;
  }

  refresh(host: Host): void {
    host.view?.dispatch({});
    this.refreshStatus();
  }

  refreshStatus(): void {
    if (!this.statusEl) return;
    const view = this.activeView;
    if (!view || !view.dom.isConnected || !view.state.field(helixField, false)) {
      this.statusEl.empty();
      return;
    }
    renderStatus(this.statusEl, this.helix, this.hostForView(view), this.viewFor({ view }));
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.helix.helixAutoPairs = this.settings.autoPairs === "helix";
  }
}

class HelixSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    readonly plugin: HelixMotionsPlugin,
  ) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Auto-pairs")
      .setDesc("Helix: Helix's auto_pairs and [editor.auto-pairs] in config.toml. Obsidian: Obsidian's own auto-pair settings.")
      .addDropdown((d) =>
        d
          .addOption("helix", "Helix")
          .addOption("obsidian", "Obsidian")
          .setValue(this.plugin.settings.autoPairs)
          .onChange(async (v) => {
            this.plugin.settings.autoPairs = v as Settings["autoPairs"];
            await this.plugin.saveSettings();
          }),
      );
    new Setting(containerEl)
      .setName("Insert keys (Enter, Tab, Backspace)")
      .setDesc("Obsidian: list continuation, list indent, table cells. Helix: Helix's insert_newline, smart_tab and delete_char_backward.")
      .addDropdown((d) =>
        d
          .addOption("obsidian", "Obsidian")
          .addOption("helix", "Helix")
          .setValue(this.plugin.settings.insertKeys)
          .onChange(async (v) => {
            this.plugin.settings.insertKeys = v as Settings["insertKeys"];
            await this.plugin.saveSettings();
          }),
      );
    new Setting(containerEl)
      .setName("Config file")
      .setDesc(`Helix config is read from ${this.plugin.configPath()}.`)
      .addButton((b) => b.setButtonText("Reload").onClick(() => void this.plugin.reloadConfig()));
  }
}

export { Context };
