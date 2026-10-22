export type IndentStyle = { kind: "tabs" } | { kind: "spaces"; width: number };

export interface StatuslineConfig {
  left: string[];
  center: string[];
  right: string[];
  separator: string;
  modeNormal: string;
  modeInsert: string;
  modeSelect: string;
}

export interface Config {
  scrolloff: number;
  scrollLines: number;
  defaultYankRegister: string;
  mouseYankRegister: string;
  jumpLabelAlphabet: string[];
  textWidth: number;
  tabWidth: number;
  indentStyle: IndentStyle;
  autoPairs: [string, string][] | false;
  autoInfo: boolean;
  smartTab: { enable: boolean; supersedeMenu: boolean };
  search: { smartCase: boolean; wrapAround: boolean };
  cursorShape: { normal: string; insert: string; select: string };
  colorModes: boolean;
  lineNumber: "absolute" | "relative";
  cursorline: boolean;
  whitespaceRender: boolean;
  trimTrailingWhitespace: boolean;
  trimFinalNewlines: boolean;
  insertFinalNewline: boolean;
  statusline: StatuslineConfig;
  continueComments: boolean;
}

export const DEFAULT_AUTO_PAIRS: [string, string][] = [
  ["(", ")"],
  ["{", "}"],
  ["[", "]"],
  ["'", "'"],
  ['"', '"'],
  ["`", "`"],
];

export function defaultConfig(): Config {
  return {
    scrolloff: 5,
    scrollLines: 3,
    defaultYankRegister: '"',
    mouseYankRegister: "*",
    jumpLabelAlphabet: [..."abcdefghijklmnopqrstuvwxyz"],
    textWidth: 80,
    tabWidth: 4,
    indentStyle: { kind: "tabs" },
    autoPairs: DEFAULT_AUTO_PAIRS,
    autoInfo: true,
    smartTab: { enable: true, supersedeMenu: false },
    search: { smartCase: true, wrapAround: true },
    cursorShape: { normal: "block", insert: "block", select: "block" },
    colorModes: false,
    lineNumber: "absolute",
    cursorline: false,
    whitespaceRender: false,
    trimTrailingWhitespace: false,
    trimFinalNewlines: false,
    insertFinalNewline: true,
    statusline: {
      left: ["mode", "spinner", "file-name", "read-only-indicator", "file-modification-indicator"],
      center: [],
      right: ["diagnostics", "selections", "register", "position", "file-encoding"],
      separator: "│",
      modeNormal: "NOR",
      modeInsert: "INS",
      modeSelect: "SEL",
    },
    continueComments: true,
  };
}

export function indentUnit(config: Config): string {
  return config.indentStyle.kind === "tabs" ? "\t" : " ".repeat(config.indentStyle.width);
}

export function indentWidth(config: Config): number {
  return config.indentStyle.kind === "tabs" ? config.tabWidth : config.indentStyle.width;
}
