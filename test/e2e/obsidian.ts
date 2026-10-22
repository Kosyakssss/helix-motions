import { parseKey } from "../../src/keys";

const VAULT = process.env.HM_VAULT ?? "test-vault";

function safe(arg: string): string {
  return arg.replace(/(?<!\\)((?:\\\\)*)\\([nt])/g, (_, pre: string, c: string) => `${pre}\\u000${c === "n" ? "a" : "9"}`);
}

export function ob(...args: string[]): string {
  args = args.map(safe);
  for (let attempt = 0; attempt < 3; attempt++) {
    const proc = Bun.spawnSync(["timeout", "-s", "KILL", "10", "obsidian", `vault=${VAULT}`, ...args], { stdout: "pipe", stderr: "pipe" });
    const out = proc.stdout.toString().trim();
    if (proc.exitCode === 0 || out !== "") return out;
  }
  throw new Error(`obsidian CLI timed out: ${args.join(" ").slice(0, 200)}`);
}

export function evalJs<T = unknown>(code: string): T {
  const out = ob("eval", `code=${code}`);
  const m = /(?:^|\n)=> ([\s\S]*)$/.exec(out);
  if (!m) throw new Error(`eval failed: ${out}`);
  const raw = m[1]!;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as T;
  }
}

export function api<T = unknown>(expr: string): T {
  return evalJs<T>(`JSON.stringify((()=>{const a=app.plugins.plugins["helix-motions"].api; return ${expr};})())`);
}

const SHIFTED: Record<string, [string, string]> = {
  "~": ["`", "Backquote"], "!": ["1", "Digit1"], "@": ["2", "Digit2"], "#": ["3", "Digit3"], $: ["4", "Digit4"],
  "%": ["5", "Digit5"], "^": ["6", "Digit6"], "&": ["7", "Digit7"], "*": ["8", "Digit8"], "(": ["9", "Digit9"],
  ")": ["0", "Digit0"], _: ["-", "Minus"], "+": ["=", "Equal"], "{": ["[", "BracketLeft"], "}": ["]", "BracketRight"],
  "|": ["\\", "Backslash"], ":": [";", "Semicolon"], '"': ["'", "Quote"], "<": [",", "Comma"], ">": [".", "Period"], "?": ["/", "Slash"],
};

const VK: Record<string, number> = {
  Backquote: 192, Minus: 189, Equal: 187, BracketLeft: 219, BracketRight: 221, Backslash: 220,
  Semicolon: 186, Quote: 222, Comma: 188, Period: 190, Slash: 191, Space: 32,
};

const PLAIN: Record<string, string> = {
  "`": "Backquote", "-": "Minus", "=": "Equal", "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash",
  ";": "Semicolon", "'": "Quote", ",": "Comma", ".": "Period", "/": "Slash", " ": "Space",
};

const NAMED: Record<string, [string, string, number]> = {
  esc: ["Escape", "Escape", 27],
  ret: ["Enter", "Enter", 13],
  tab: ["Tab", "Tab", 9],
  backspace: ["Backspace", "Backspace", 8],
  del: ["Delete", "Delete", 46],
  left: ["ArrowLeft", "ArrowLeft", 37],
  right: ["ArrowRight", "ArrowRight", 39],
  up: ["ArrowUp", "ArrowUp", 38],
  down: ["ArrowDown", "ArrowDown", 40],
  home: ["Home", "Home", 36],
  end: ["End", "End", 35],
  pageup: ["PageUp", "PageUp", 33],
  pagedown: ["PageDown", "PageDown", 34],
};

export interface DomKey {
  key: string;
  code: string;
  text?: string;
  keyCode: number;
  modifiers: number;
}

export function domKey(helixKey: string, override?: Partial<DomKey>): DomKey {
  const k = parseKey(helixKey);
  let modifiers = (k.alt ? 1 : 0) | (k.ctrl ? 2 : 0) | (k.meta ? 4 : 0) | (k.shift ? 8 : 0);
  let key: string;
  let code: string;
  let keyCode: number;
  let text: string | undefined;
  const named = NAMED[k.code];
  if (named) {
    [key, code, keyCode] = named;
    if (k.code === "ret" && !k.ctrl && !k.alt && !k.meta) text = "\r";
  } else {
    const ch = k.code;
    key = ch;
    if (/^[a-z]$/.test(ch)) {
      code = `Key${ch.toUpperCase()}`;
      keyCode = ch.toUpperCase().charCodeAt(0);
    } else if (/^[A-Z]$/.test(ch)) {
      code = `Key${ch}`;
      keyCode = ch.charCodeAt(0);
      modifiers |= 8;
    } else if (/^[0-9]$/.test(ch)) {
      code = `Digit${ch}`;
      keyCode = ch.charCodeAt(0);
    } else if (SHIFTED[ch]) {
      code = SHIFTED[ch]![1];
      keyCode = VK[code] ?? SHIFTED[ch]![0].charCodeAt(0);
      modifiers |= 8;
    } else if (PLAIN[ch]) {
      code = PLAIN[ch]!;
      keyCode = VK[code] ?? 0;
    } else {
      code = "";
      keyCode = 0;
    }
    if (!k.ctrl && !k.meta && !k.alt) text = ch;
  }
  return { key, code, text, keyCode, modifiers, ...override };
}

export function sendDomKey(d: DomKey): void {
  const down: Record<string, unknown> = {
    type: d.text ? "keyDown" : "rawKeyDown",
    key: d.key,
    code: d.code,
    windowsVirtualKeyCode: d.keyCode,
    nativeVirtualKeyCode: d.keyCode,
    modifiers: d.modifiers,
  };
  if (d.text) {
    down.text = d.text;
    down.unmodifiedText = d.text;
  }
  ob("dev:cdp", "method=Input.dispatchKeyEvent", `params=${JSON.stringify(down)}`);
  ob(
    "dev:cdp",
    "method=Input.dispatchKeyEvent",
    `params=${JSON.stringify({ type: "keyUp", key: d.key, code: d.code, windowsVirtualKeyCode: d.keyCode, modifiers: d.modifiers })}`,
  );
}

export function sendKeys(keys: string[]): void {
  for (const k of keys) sendDomKey(domKey(k));
}

export function insertText(text: string): void {
  ob("dev:cdp", "method=Input.insertText", `params=${JSON.stringify({ text })}`);
}

export function mouse(type: "mousePressed" | "mouseReleased" | "mouseMoved", x: number, y: number, extra: Record<string, unknown> = {}): void {
  ob("dev:cdp", "method=Input.dispatchMouseEvent", `params=${JSON.stringify({ type, x, y, button: "left", clickCount: 1, ...extra })}`);
}

export interface AppState {
  markup: string;
  mode: string;
  native: [number, number][];
  nativeMain: number;
  status: { message: string; severity: string } | null;
  prompt: { label: string; line: string } | null;
  pending: string;
  focus: boolean;
  classes: string;
}

export function setDoc(markup: string): void {
  api(`a.set(${JSON.stringify(markup)})`);
}

export function state(): AppState {
  return api<AppState>("a.state()");
}

export function openScratch(): void {
  ob("dev:cdp", "method=Emulation.setFocusEmulationEnabled", 'params={"enabled":true}');
  ob("dev:cdp", "method=Page.setWebLifecycleState", 'params={"state":"active"}');
  ob("open", "path=scratch.md");
}
