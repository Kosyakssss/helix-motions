export interface KeyEvent {
  readonly code: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
}

const NAMED = new Set([
  "backspace",
  "ret",
  "left",
  "right",
  "up",
  "down",
  "home",
  "end",
  "pageup",
  "pagedown",
  "tab",
  "del",
  "ins",
  "null",
  "esc",
  "capslock",
  "scrolllock",
  "numlock",
  "printscreen",
  "pause",
  "menu",
  "keypadbegin",
]);

const CHAR_NAMES: Record<string, string> = { space: " ", minus: "-", lt: "<", gt: ">" };
const NAME_OF_CHAR: Record<string, string> = { " ": "space", "-": "minus", "<": "lt", ">": "gt" };

export function parseKey(input: string): KeyEvent {
  const tokens = input.split("-");
  let last = tokens.pop();
  if (last === undefined) throw new Error("Missing key code");
  if (last === "" && input.endsWith("-")) {
    if (input === "-") return { code: "-", ctrl: false, alt: false, shift: false, meta: false };
    throw new Error(`Key '-' cannot be used with modifiers, use '${input.slice(0, -1)}minus' instead`);
  }
  let code: string;
  if (NAMED.has(last)) code = last;
  else if (last in CHAR_NAMES) code = CHAR_NAMES[last]!;
  else if ([...last].length === 1) code = last;
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(last)) code = last;
  else throw new Error(`Invalid key code '${last}'`);
  let ctrl = false;
  let alt = false;
  let shift = false;
  let meta = false;
  for (const token of tokens) {
    if (token === "S") {
      if (shift) throw new Error("Repeated key modifier 'S-'");
      shift = true;
    } else if (token === "A") {
      if (alt) throw new Error("Repeated key modifier 'A-'");
      alt = true;
    } else if (token === "C") {
      if (ctrl) throw new Error("Repeated key modifier 'C-'");
      ctrl = true;
    } else if (token === "Meta" || token === "Cmd" || token === "Win") {
      if (meta) throw new Error(`Repeated key modifier '${token}-'`);
      meta = true;
    } else {
      throw new Error(`Invalid key modifier '${token}-'`);
    }
  }
  if ([...code].length === 1 && /[a-z]/.test(code) && shift) {
    code = code.toUpperCase();
    shift = false;
  }
  return { code, ctrl, alt, shift, meta };
}

export function formatKey(key: KeyEvent): string {
  let out = "";
  if (key.meta) out += "Meta-";
  if (key.shift) out += "S-";
  if (key.alt) out += "A-";
  if (key.ctrl) out += "C-";
  return out + (NAME_OF_CHAR[key.code] ?? key.code);
}

export function canonicalizeKey(key: KeyEvent): KeyEvent {
  if (isCharCode(key.code) && key.shift) return { ...key, shift: false };
  return key;
}

export function normalizeKeyString(input: string): string {
  return formatKey(canonicalizeKey(parseKey(input)));
}

export function isCharCode(code: string): boolean {
  return [...code].length === 1;
}

export function keyChar(key: string): string | null {
  const parsed = parseKey(key);
  return isCharCode(parsed.code) ? parsed.code : null;
}

export function keyCharUnmodified(key: string): string | null {
  const parsed = parseKey(key);
  if (!isCharCode(parsed.code) || parsed.ctrl || parsed.alt || parsed.meta) return null;
  return parsed.code;
}

export function parseMacro(input: string): string[] {
  const keys: string[] = [];
  const chars = [...input];
  let i = 0;
  while (i < chars.length) {
    const c = chars[i]!;
    if (c === ">") throw new Error("Unmatched '>'");
    if (c !== "<") {
      keys.push(normalizeKeyString(c === "-" ? "minus" : c === " " ? "space" : c));
      i++;
      continue;
    }
    const end = chars.indexOf(">", i);
    if (end < 0) throw new Error("'>' expected");
    keys.push(normalizeKeyString(chars.slice(i + 1, end).join("")));
    i = end + 1;
  }
  return keys;
}

export function keySequenceFormat(key: string): string {
  return [...key].length > 1 ? `<${key}>` : key;
}

const DOM_NAMED: Record<string, string> = {
  Backspace: "backspace",
  Enter: "ret",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
  Tab: "tab",
  Delete: "del",
  Insert: "ins",
  Escape: "esc",
  CapsLock: "capslock",
  ScrollLock: "scrolllock",
  NumLock: "numlock",
  PrintScreen: "printscreen",
  Pause: "pause",
  ContextMenu: "menu",
};

const IGNORED = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "AltGraph",
  "OS",
  "Hyper",
  "Super",
  "Fn",
  "FnLock",
  "Dead",
  "Process",
  "Unidentified",
  "Compose",
]);

const US_LAYOUT: Record<string, [string, string]> = {
  Backquote: ["`", "~"],
  Digit1: ["1", "!"],
  Digit2: ["2", "@"],
  Digit3: ["3", "#"],
  Digit4: ["4", "$"],
  Digit5: ["5", "%"],
  Digit6: ["6", "^"],
  Digit7: ["7", "&"],
  Digit8: ["8", "*"],
  Digit9: ["9", "("],
  Digit0: ["0", ")"],
  Minus: ["-", "_"],
  Equal: ["=", "+"],
  BracketLeft: ["[", "{"],
  BracketRight: ["]", "}"],
  Backslash: ["\\", "|"],
  IntlBackslash: ["\\", "|"],
  Semicolon: [";", ":"],
  Quote: ["'", "\""],
  Comma: [",", "<"],
  Period: [".", ">"],
  Slash: ["/", "?"],
  Space: [" ", " "],
};

function physicalChar(code: string, shift: boolean): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return shift ? letter[1]! : letter[1]!.toLowerCase();
  const pair = US_LAYOUT[code];
  if (pair) return shift ? pair[1] : pair[0];
  const numpad = /^Numpad(\d)$/.exec(code);
  if (numpad) return numpad[1]!;
  return null;
}

export interface DomKeyLike {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}

export function keyFromDom(e: DomKeyLike, literal: boolean): string | null {
  if (IGNORED.has(e.key)) return null;
  let code: string;
  let alt = e.altKey;
  const named = DOM_NAMED[e.key];
  if (named) {
    code = named;
  } else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)) {
    code = e.key;
  } else if ([...e.key].length === 1) {
    code = e.key;
    const nonAscii = e.key.charCodeAt(0) > 127;
    const macOptionChar = e.altKey && !e.ctrlKey;
    if (literal) {
      if (macOptionChar) alt = false;
      if (e.ctrlKey && nonAscii) code = physicalChar(e.code, e.shiftKey) ?? code;
    } else if (nonAscii || macOptionChar || (e.ctrlKey && !/^[\x20-\x7e]$/.test(e.key))) {
      code = physicalChar(e.code, e.shiftKey) ?? code;
    }
  } else {
    return null;
  }
  return formatKey(canonicalizeKey({ code, ctrl: e.ctrlKey, alt, shift: e.shiftKey, meta: e.metaKey }));
}
