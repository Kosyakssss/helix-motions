import { MarkdownView, Notice, Plugin, TFile, editorInfoField, normalizePath } from "obsidian";
import type { EditorView } from "@codemirror/view";
import type { Extension, TransactionSpec } from "@codemirror/state";
import { HelixEditor, Context } from "./core/editor";
import type { Host } from "./core/host";
import { buildKeymaps } from "./keymap";
import { loadConfig } from "./config-loader";
import { defaultConfig, type Config } from "./config";
import { helixExtension } from "./obsidian/view";
import { runScopeHandlers } from "@codemirror/view";
import { deleteCharBackward, insertNewlineAndIndent } from "@codemirror/commands";
import { makeWorkspace, leafId } from "./obsidian/workspace";
import { makeViewOps } from "./obsidian/viewops";
import { renderStatus } from "./obsidian/status";
import { commentTokensAt } from "./obsidian/comments";
import { loadRegex, loadSyntax } from "./obsidian/syntax";
import { setRegexEngine } from "./core/regex";
import type { SyntaxSessions } from "./syntax/languages";
import { SystemClipboard } from "./obsidian/clipboard";
import { helixField } from "./state";
import { Registers } from "./registers";
import { commitHistoryNow } from "./commands/jumps";
import { setPathCompleter } from "./commands/typed";
import { print, plain } from "./core/markup";
import { setHelix, helixOwned, toNative } from "./state";
import { DEFAULT_SETTINGS, HelixSettingTab, type Settings } from "./obsidian/settings";

export default class HelixMotionsPlugin extends Plugin {
  override settings: Settings = DEFAULT_SETTINGS;
  helix!: HelixEditor;
  hosts = new WeakMap<EditorView, Host>();
  statusEl!: HTMLElement;
  lastFileByLeaf = new Map<string, string[]>();
  lastModified: string[] = [];
  private activeView: EditorView | null = null;
  configWarnings: string[] = [];
  editorExtension: Extension = [];
  private configView: EditorView | null = null;
  private settingTab: HelixSettingTab | null = null;
  private syntaxSessions: SyntaxSessions | null = null;
  private syntaxViews = new Set<EditorView>();

  override async onload(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<Settings> | null) };
    const vault = this.app.vault as unknown as { getConfig(key: string): unknown };
    const plugins = (this.app as unknown as { plugins: { enabledPlugins: Set<string> } }).plugins;
    if (vault.getConfig("vimMode")) {
      new Notice("Helix: turn off vim key bindings in the editor settings, then reload the plugin.", 0);
      return;
    }
    if (plugins.enabledPlugins.has("vim-motions")) {
      new Notice("Helix: turn off the vim motions plugin, then reload this plugin.", 0);
      return;
    }
    this.helix = new HelixEditor(buildKeymaps(), this.baseConfig());
    this.helix.onConfigChanged = () => {
      this.applyViewConfig();
      this.refreshStatus();
    };
    this.helix.visualLines = true;
    this.helix.continueLists = true;
    this.helix.helixAutoPairs = this.settings.autoPairs === "helix";
    const clipboard = new SystemClipboard();
    clipboard.refresh();
    this.helix.registers = new Registers(clipboard);
    this.registerDomEvent(window, "focus", () => clipboard.refresh());
    this.registerDomEvent(document, "copy", () => window.setTimeout(() => clipboard.refresh(), 0));
    this.registerDomEvent(document, "cut", () => window.setTimeout(() => clipboard.refresh(), 0));
    this.helix.workspace = makeWorkspace(this);
    this.helix.viewOps = makeViewOps(() => this.helix.config.scrolloff);
    this.helix.commentTokens = (host, pos) => commentTokensAt(host.state.doc, pos);
    void loadSyntax()
      .then((sessions) => {
        this.syntaxSessions = sessions;
        for (const view of this.syntaxViews) if (!this.isConfigView(view)) sessions.open(view, view.state.doc);
        this.helix.syntax = (host) =>
          host.view && !this.isConfigView(host.view) ? sessions.get(host.view, host.state.doc) : null;
      })
      .catch((err: unknown) => console.error("Helix: syntax tree unavailable", err));
    void loadRegex()
      .then((engine) => setRegexEngine(engine))
      .catch((err: unknown) => console.error("Helix: regex engine unavailable", err));
    this.helix.ui = {
      notify: () =>
        queueMicrotask(() => {
          if (this.activeView?.dom.isConnected) this.refresh(this.hostForView(this.activeView));
          else this.refreshStatus();
        }),
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
    setPathCompleter((prefix) => {
      const lower = prefix.toLowerCase();
      return this.app.vault
        .getFiles()
        .map((f) => (f.extension === "md" ? f.path.slice(0, -3) : f.path))
        .filter((p) => p.toLowerCase().startsWith(lower) || (lower !== "" && p.toLowerCase().includes(lower)))
        .sort((a, b) => Number(!a.toLowerCase().startsWith(lower)) - Number(!b.toLowerCase().startsWith(lower)) || a.localeCompare(b));
    });
    await this.reloadConfig();
    this.editorExtension = helixExtension({
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
        onDocTransaction: (view, tr) => this.syntaxSessions?.change(view, tr.startState.doc, tr.changes, tr.newDoc),
        onViewOpen: (view) => {
          this.syntaxViews.add(view);
          if (!this.isConfigView(view)) this.syntaxSessions?.open(view, view.state.doc);
        },
        onViewClose: (view) => {
          this.syntaxViews.delete(view);
          this.syntaxSessions?.close(view);
        },
        physicalKeys: () => this.settings.physicalKeys,
      });
    this.registerEditorExtension(this.editorExtension);
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("hx-status");
    const bar = this.statusEl.parentElement;
    if (bar) {
      let width = bar.offsetWidth;
      const observer = new ResizeObserver(() => {
        if (Math.abs(bar.offsetWidth - width) < 1) return;
        width = bar.offsetWidth;
        this.refreshStatus();
      });
      observer.observe(bar);
      this.register(() => observer.disconnect());
    }
    this.settingTab = new HelixSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.addCommand({ id: "reload-config", name: "Reload helix.toml", callback: () => void this.reloadConfig() });
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
        this.refreshStatus();
      }),
    );
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.refreshStatus()));
    this.registerEvent(this.app.workspace.on("css-change", () => window.requestAnimationFrame(() => this.refreshStatus())));
    const onConfigFile = (file: { path: string }, oldPath?: string) => {
      if (file.path === this.configPath() || oldPath === this.configPath()) void this.reloadConfig();
    };
    this.registerEvent(this.app.vault.on("modify", (file) => onConfigFile(file)));
    this.registerEvent(this.app.vault.on("create", (file) => onConfigFile(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => onConfigFile(file)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => onConfigFile(file, oldPath)));
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
        this.applyViewConfig();
        this.refreshStatus();
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
    this.syntaxSessions?.clear();
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
    return normalizePath("helix.toml");
  }

  async readConfigSource(): Promise<string | null> {
    const file = this.app.vault.getFileByPath(this.configPath());
    return file ? await this.app.vault.read(file) : null;
  }

  async saveConfigSource(text: string): Promise<void> {
    const file = this.app.vault.getFileByPath(this.configPath());
    if (file) await this.app.vault.modify(file, text);
    else await this.app.vault.create(this.configPath(), text);
    await this.reloadConfig();
  }

  setConfigView(view: EditorView | null): void {
    this.configView = view;
    if (view) this.syntaxSessions?.close(view);
  }

  escapeConfig(view: EditorView): void {
    this.helix.feedKeys(this.hostForView(view), "<esc>");
  }

  isConfigView(view: EditorView | null): boolean {
    return view !== null && view === this.configView;
  }

  openSettings(): void {
    const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
    setting?.open();
    setting?.openTabById(this.manifest.id);
  }

  async reloadConfig(): Promise<void> {
    const source = await this.readConfigSource();
    const loaded = loadConfig(source, this.baseConfig());
    const changed = loaded.warnings.join("\n") !== this.configWarnings.join("\n");
    this.helix.config = loaded.config;
    this.helix.keymaps = buildKeymaps(loaded.keys);
    this.configWarnings = loaded.warnings;
    this.settingTab?.showWarnings();
    if (changed && loaded.warnings.length > 0) {
      new Notice(`Helix: ${loaded.warnings.length === 1 ? "1 warning" : `${loaded.warnings.length} warnings`} in helix.toml, see the plugin settings.`);
    }
    this.applyViewConfig();
    this.refreshStatus();
  }

  applyViewConfig(): void {
    const config = this.helix.config;
    const lineNumbers = config.gutterLineNumbers ?? (config.lineNumber !== null ? true : null);
    if (lineNumbers !== null) this.setObsidianOption("showLineNumber", lineNumbers);
    if (config.indentGuides !== null) this.setObsidianOption("showIndentGuide", config.indentGuides);
  }

  setObsidianOption(key: string, value: boolean): void {
    const vault = this.app.vault as unknown as { getConfig(key: string): unknown; setConfig(key: string, value: unknown): void };
    if (vault.getConfig(key) !== value) vault.setConfig(key, value);
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

  private uiSignature = "";

  refresh(host: Host): void {
    const p = this.helix.activePrompt;
    const auto = this.helix.autoinfo;
    const sig = JSON.stringify([
      p ? [p.label, p.line, p.cursor, p.selection, p.completions.length] : null,
      auto ? ("kind" in auto ? auto.name : auto.title) : null,
      this.helix.status,
      this.helix.jumpLabels.get(host.id)?.length ?? 0,
    ]);
    if (sig !== this.uiSignature) {
      this.uiSignature = sig;
      host.view?.dispatch({});
    }
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

export { Context };
