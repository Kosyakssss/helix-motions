import { parse } from "smol-toml";
import { defaultConfig, type Config } from "./config";
import type { KeyNode, RawTrie } from "./keymap/trie";
import { parseCommand } from "./keymap/trie";
import { normalizeKeyString } from "./keys";
import { isKnownCommand } from "./commands";
import { TYPABLE_MAP, splitCommandLine } from "./commands/typed";

export interface LoadedConfig {
  config: Config;
  keys: Partial<Record<"normal" | "select" | "insert", KeyNode>>;
  warnings: string[];
}

const IGNORED_EDITOR = new Set([
  "mouse",
  "middle-click-paste",
  "shell",
  "auto-completion",
  "path-completion",
  "auto-format",
  "idle-timeout",
  "completion-timeout",
  "preview-completion-insert",
  "completion-trigger-len",
  "completion-replace",
  "true-color",
  "undercurl",
  "rulers",
  "bufferline",
  "workspace-lsp-roots",
  "default-line-ending",
  "atomic-save",
  "popup-border",
  "indent-heuristic",
  "end-of-line-diagnostics",
  "clipboard-provider",
  "editor-config",
  "rainbow-brackets",
  "kitty-keyboard-protocol",
  "cursorcolumn",
  "lsp",
  "file-picker",
  "file-explorer",
  "buffer-picker",
  "auto-save",
  "soft-wrap",
  "inline-diagnostics",
  "word-completion",
  "workspace-trust",
]);

function asBool(v: unknown, key: string, warnings: string[]): boolean | undefined {
  if (typeof v === "boolean") return v;
  warnings.push(`editor.${key}: expected a boolean`);
  return undefined;
}

function asNum(v: unknown, key: string, warnings: string[]): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  warnings.push(`editor.${key}: expected a number`);
  return undefined;
}

function asStr(v: unknown, key: string, warnings: string[]): string | undefined {
  if (typeof v === "string") return v;
  warnings.push(`editor.${key}: expected a string`);
  return undefined;
}

function applyEditor(config: Config, editor: Record<string, unknown>, warnings: string[]): void {
  for (const [key, value] of Object.entries(editor)) {
    switch (key) {
      case "scrolloff": {
        const n = asNum(value, key, warnings);
        if (n !== undefined) config.scrolloff = n;
        break;
      }
      case "scroll-lines": {
        const n = asNum(value, key, warnings);
        if (n !== undefined) config.scrollLines = n;
        break;
      }
      case "default-yank-register": {
        const s = asStr(value, key, warnings);
        if (s !== undefined) config.defaultYankRegister = s;
        break;
      }
      case "mouse-yank-register": {
        const s = asStr(value, key, warnings);
        if (s !== undefined) config.mouseYankRegister = s;
        break;
      }
      case "jump-label-alphabet": {
        const s = asStr(value, key, warnings);
        if (s !== undefined) config.jumpLabelAlphabet = [...s];
        break;
      }
      case "text-width": {
        const n = asNum(value, key, warnings);
        if (n !== undefined) config.textWidth = n;
        break;
      }
      case "auto-info": {
        const b = asBool(value, key, warnings);
        if (b !== undefined) config.autoInfo = b;
        break;
      }
      case "color-modes": {
        const b = asBool(value, key, warnings);
        if (b !== undefined) config.colorModes = b;
        break;
      }
      case "cursorline": {
        const b = asBool(value, key, warnings);
        if (b !== undefined) config.cursorline = b;
        break;
      }
      case "continue-comments": {
        const b = asBool(value, key, warnings);
        if (b !== undefined) config.continueComments = b;
        break;
      }
      case "trim-trailing-whitespace": {
        const b = asBool(value, key, warnings);
        if (b !== undefined) config.trimTrailingWhitespace = b;
        break;
      }
      case "trim-final-newlines": {
        const b = asBool(value, key, warnings);
        if (b !== undefined) config.trimFinalNewlines = b;
        break;
      }
      case "insert-final-newline": {
        const b = asBool(value, key, warnings);
        if (b !== undefined) config.insertFinalNewline = b;
        break;
      }
      case "line-number":
        if (value === "absolute" || value === "relative") config.lineNumber = value;
        else warnings.push(`editor.line-number: expected "absolute" or "relative"`);
        if (value === "relative") warnings.push("editor.line-number: relative numbers are not drawn; Obsidian shows absolute line numbers");
        break;
      case "gutters": {
        const layout = Array.isArray(value) ? value : (value as Record<string, unknown> | null)?.layout;
        if (Array.isArray(layout)) config.gutterLineNumbers = layout.includes("line-numbers");
        else if (value && typeof value === "object" && !Array.isArray(value)) break;
        else warnings.push("editor.gutters: expected a list or a table with layout");
        break;
      }
      case "indent-guides": {
        const render = (value as Record<string, unknown> | null)?.render;
        if (typeof render === "boolean") config.indentGuides = render;
        break;
      }
      case "auto-pairs":
        if (value === false) config.autoPairs = false;
        else if (value === true) break;
        else if (value && typeof value === "object") {
          config.autoPairs = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => typeof v === "string")
            .map(([o, c]) => [o, c as string]);
        } else warnings.push("editor.auto-pairs: expected a boolean or a table");
        break;
      case "search": {
        const s = value as Record<string, unknown>;
        for (const [k, v] of Object.entries(s ?? {})) {
          if (k === "smart-case" && typeof v === "boolean") config.search.smartCase = v;
          else if (k === "wrap-around" && typeof v === "boolean") config.search.wrapAround = v;
          else warnings.push(`editor.search.${k}: not supported`);
        }
        break;
      }
      case "smart-tab": {
        const s = value as Record<string, unknown>;
        for (const [k, v] of Object.entries(s ?? {})) {
          if (k === "enable" && typeof v === "boolean") config.smartTab.enable = v;
          else if (k === "supersede-menu" && typeof v === "boolean") config.smartTab.supersedeMenu = v;
          else warnings.push(`editor.smart-tab.${k}: not supported`);
        }
        break;
      }
      case "cursor-shape": {
        const s = value as Record<string, unknown>;
        for (const [k, v] of Object.entries(s ?? {})) {
          if ((k === "normal" || k === "insert" || k === "select") && typeof v === "string") config.cursorShape[k] = v;
          else warnings.push(`editor.cursor-shape.${k}: not supported`);
        }
        break;
      }
      case "whitespace":
        warnings.push("editor.whitespace: not drawn; Obsidian shows its own indentation guides");
        break;
      case "statusline": {
        const s = value as Record<string, unknown>;
        for (const [k, v] of Object.entries(s ?? {})) {
          if ((k === "left" || k === "center" || k === "right") && Array.isArray(v)) config.statusline[k] = v.map(String);
          else if (k === "separator" && typeof v === "string") config.statusline.separator = v;
          else if (k === "mode" && v && typeof v === "object") {
            const m = v as Record<string, unknown>;
            if (typeof m.normal === "string") config.statusline.modeNormal = m.normal;
            if (typeof m.insert === "string") config.statusline.modeInsert = m.insert;
            if (typeof m.select === "string") config.statusline.modeSelect = m.select;
          } else if (k !== "diagnostics" && k !== "workspace-diagnostics") warnings.push(`editor.statusline.${k}: not supported`);
        }
        break;
      }
      default:
        if (!IGNORED_EDITOR.has(key)) warnings.push(`editor.${key}: unknown key`);
    }
  }
}

function checkCommand(raw: string, path: string, warnings: string[]): boolean {
  const cmd = parseCommand(raw);
  if (cmd.kind === "static" && !isKnownCommand(cmd.name)) {
    warnings.push(`${path}: unknown command "${cmd.name}"`);
    return false;
  }
  if (cmd.kind === "typable") {
    const [name] = splitCommandLine(cmd.raw);
    if (!/^\d+$/.test(name) && !TYPABLE_MAP.has(name)) {
      warnings.push(`${path}: typed command ":${name}" is not supported`);
      return false;
    }
  }
  return true;
}

function convertTrie(value: unknown, path: string, warnings: string[]): RawTrie | null {
  if (typeof value === "string") return checkCommand(value, path, warnings) ? value : null;
  if (Array.isArray(value)) {
    const cmds = value.map(String);
    if (cmds.some((c) => c.startsWith("@"))) {
      warnings.push(`${path}: macro keybindings may not be used in command sequences`);
      return null;
    }
    const ok = cmds.filter((c) => checkCommand(c, path, warnings));
    return ok.length > 0 ? ok : null;
  }
  if (value && typeof value === "object") {
    const map: Record<string, RawTrie> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      try {
        normalizeKeyString(k);
      } catch (err) {
        warnings.push(`${path}.${k}: ${(err as Error).message}`);
        continue;
      }
      const t = convertTrie(v, `${path}.${k}`, warnings);
      if (t !== null) map[k] = t;
    }
    return { name: "", map };
  }
  warnings.push(`${path}: expected a command, list of commands, or sub-keymap`);
  return null;
}

export function loadConfig(source: string | null, base: Config = defaultConfig()): LoadedConfig {
  const config: Config = structuredClone(base);
  const warnings: string[] = [];
  const keys: LoadedConfig["keys"] = {};
  if (source === null) return { config, keys, warnings };
  let doc: Record<string, unknown>;
  try {
    doc = parse(source) as Record<string, unknown>;
  } catch (err) {
    warnings.push(`config.toml: ${(err as Error).message}`);
    return { config, keys, warnings };
  }
  for (const [section, value] of Object.entries(doc)) {
    if (section === "editor") applyEditor(config, value as Record<string, unknown>, warnings);
    else if (section === "keys") {
      for (const [mode, table] of Object.entries(value as Record<string, unknown>)) {
        if (mode !== "normal" && mode !== "select" && mode !== "insert") {
          warnings.push(`keys.${mode}: unknown mode`);
          continue;
        }
        const t = convertTrie(table, `keys.${mode}`, warnings);
        if (t && typeof t === "object" && !Array.isArray(t)) keys[mode] = t;
      }
    } else if (section === "theme") {
      continue;
    } else warnings.push(`${section}: unknown section`);
  }
  return { config, keys, warnings };
}
