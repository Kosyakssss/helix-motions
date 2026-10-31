import { PluginSettingTab, Scope, type App, type Plugin, type Setting, type SettingDefinitionItem } from "obsidian";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";

export interface Settings {
  autoPairs: "obsidian" | "helix";
  insertKeys: "obsidian" | "helix";
  physicalKeys: boolean;
}

export const DEFAULT_SETTINGS: Settings = { autoPairs: "obsidian", insertKeys: "obsidian", physicalKeys: true };

export interface SettingsHost extends Plugin {
  settings: Settings;
  configWarnings: string[];
  editorExtension: Extension;
  configPath(): string;
  readConfigSource(): Promise<string | null>;
  saveConfigSource(text: string): Promise<void>;
  saveSettings(): Promise<void>;
  setConfigView(view: EditorView | null): void;
  escapeConfig(view: EditorView): void;
}

export class HelixSettingTab extends PluginSettingTab {
  private warningsEl: HTMLElement | null = null;

  constructor(
    app: App,
    readonly host: SettingsHost,
  ) {
    super(app, host);
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        items: [
          {
            name: "Auto-pairs",
            desc: "Obsidian: the auto-pair options in the editor settings. Helix: auto-pairs from Helix and the [editor.auto-pairs] table in helix.toml.",
            control: { type: "dropdown", key: "autoPairs", options: { obsidian: "Obsidian", helix: "Helix" }, defaultValue: "obsidian" },
          },
          {
            name: "Enter, tab and backspace in insert mode",
            desc: "Obsidian: list continuation, list indent and table cells. Helix: insert_newline, smart_tab and delete_char_backward.",
            control: { type: "dropdown", key: "insertKeys", options: { obsidian: "Obsidian", helix: "Helix" }, defaultValue: "obsidian" },
          },
          {
            name: "Read keys by position",
            desc: "With a non-Latin keyboard layout, normal and select mode read each key by its position on a US keyboard. Keys that wait for a character, such as f, t, r and registers, still get the typed character.",
            aliases: ["layout", "cyrillic", "physical keys"],
            control: { type: "toggle", key: "physicalKeys", defaultValue: true },
          },
        ],
      },
      {
        type: "group",
        heading: "Helix config",
        items: [
          {
            name: "helix.toml",
            desc: `The Helix config file, read from ${this.host.configPath()} in the vault. Use the same format as the config.toml file of Helix. Save with :w or Mod+S.`,
            aliases: ["config", "keys", "keymap", "toml"],
            render: (setting) => this.renderEditor(setting),
          },
        ],
      },
    ];
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    (this.host.settings as unknown as Record<string, unknown>)[key] = value;
    await this.host.saveSettings();
  }

  showWarnings(): void {
    const el = this.warningsEl;
    if (!el) return;
    el.empty();
    const warnings = this.host.configWarnings;
    el.toggleClass("hx-hidden", warnings.length === 0);
    for (const warning of warnings) el.createDiv({ cls: "hx-config-warning", text: warning });
  }

  private renderEditor(setting: Setting): () => void {
    setting.settingEl.addClass("hx-config-setting");
    const box = setting.settingEl.createDiv({ cls: "hx-config-editor" });
    this.warningsEl = setting.settingEl.createDiv({ cls: "hx-config-warnings hx-hidden" });
    let saved = "";
    const save = () => {
      saved = view.state.doc.toString();
      void this.host.saveConfigSource(saved);
      return true;
    };
    const view = new EditorView({
      parent: box,
      state: EditorState.create({
        doc: "",
        extensions: [this.host.editorExtension, EditorView.lineWrapping, keymap.of([{ key: "Mod-s", run: save }, ...defaultKeymap])],
      }),
    });
    const scope = new Scope(this.app.scope);
    scope.register([], "Escape", () => {
      this.host.escapeConfig(view);
      return false;
    });
    view.contentDOM.addEventListener("focus", () => this.app.keymap.pushScope(scope));
    view.contentDOM.addEventListener("blur", () => this.app.keymap.popScope(scope));
    setting.addButton((b) =>
      b.setButtonText("Revert").onClick(() => {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: saved } });
      }),
    );
    setting.addButton((b) => b.setButtonText("Save").setCta().onClick(save));
    void this.host.readConfigSource().then((text) => {
      saved = text ?? "";
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: saved } });
    });
    this.host.setConfigView(view);
    this.showWarnings();
    return () => {
      this.app.keymap.popScope(scope);
      this.host.setConfigView(null);
      this.warningsEl = null;
      view.destroy();
    };
  }
}
