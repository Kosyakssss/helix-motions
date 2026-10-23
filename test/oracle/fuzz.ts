import type { Case } from "./oracle";

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

const WORDS = ["foo", "bar", "baz_qux", "Hello", "x", "  ", "\t", "(", ")", "[", "]", "{", "}", "\"", "'", ",", ".", "-", "123", "0x1f", "café", "мир", "👋🏽", "漢字", "é", "camelCase", "a.b", "->", "  ", "", "#", "//", "%%"];

const KEYS = [
  "h", "j", "k", "l", "w", "b", "e", "W", "B", "E", "x", "X", "%", ";", ",", "C", "<A-C>", "<A-s>", "<A-minus>", "<A-_>",
  "_", "(", ")", "<A-;>", "<A-:>", "gh", "gl", "gs", "gg", "ge", "gj", "gk", "]p", "[p", "v", "v", "<esc>", "2", "3",
  "fa", "fo", "f(", "ta", "Fa", "Ta", "mm", "miw", "maw", "mip", "map", "mi(", "ma(", "mi\"", "mim", "mam",
  "d", "<A-d>", "c<esc>", "cZ<esc>", "iab<esc>", "aab<esc>", "Iq<esc>", "Aq<esc>", "o<esc>", "O<esc>", "oz<esc>",
  "rx", "~", "`", "y", "p", "P", "R", "<gt>", "<lt>", "J", "<A-J>", "u", "U", "<A-u>", "<A-U>", "<C-a>", "<C-x>",
  "ms(", "md(", "mr([", "]<space>", "[<space>", ".", "i(<esc>", "i\"<esc>", "i<ret><esc>", "i<tab><esc>",
  "i<backspace><esc>", "a<backspace><esc>", "i<C-w><esc>", "i<del><esc>", "&", "<A-(>", "<A-)>",
  "s\\w+<ret>", "So<ret>", "Ko<ret>", "/o<ret>", "n", "N", "*", "<C-s>", "<C-o>", "<C-i>", "<A-.>", "<C-c>",
  "<A-x>", "X", "%<A-s>", "s.<ret>", "S<space><ret>", "<A-K>a<ret>", "mi'", "ma[", "mi{", "mr(\"", "ms\"", "ms[", "md\"",
  "\"ay", "\"ap", "\"aP", "\"_d", "\"bR", "I", "A", "i(x)<esc>", "a\"<esc>", "i'<esc>", "i<space><esc>", "i)<esc>",
  "i<C-u><esc>", "i<C-k><esc>", "i<A-d><esc>", "i<A-backspace><esc>", "<A-`>", "ra", "r<ret>", "~", "vl", "vw", "vj", "vgl",
  "vfa", "v%", "vx", "v;", "v<A-;>", "vb", "ve", "vW", "vgg", "vge", "vmiw", "vn", "vN", "4", "10",
  "<C-a>", "5<C-x>", "\"#<C-a>", ":sort<ret>", ":sort -r<ret>", "<A-C>", "C", "2C", ",", "<A-,>", "<A-minus>", "<A-_>",
  "Qwq", "Qiz<esc>Qq", "ifoo<esc>.", "o(<esc>", "O\"<esc>", "]p", "[p", "2]p", "gk", "gj", "<A-)>", "<A-(>",
];

export function fuzzSuite(n: number, seed: number): Case[] {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const cases: Case[] = [];
  for (let i = 0; i < n; i++) {
    const lines: string[] = [];
    const lineCount = 1 + Math.floor(r() * 5);
    for (let l = 0; l < lineCount; l++) {
      const wc = Math.floor(r() * 7);
      const parts: string[] = [];
      for (let w = 0; w < wc; w++) parts.push(pick(WORDS));
      lines.push(parts.join(r() < 0.7 ? " " : ""));
    }
    let text = lines.join("\n");
    if (r() < 0.8) text += "\n";
    const chars = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((g) => g.segment);
    const at = Math.floor(r() * Math.max(1, chars.length));
    const g = chars[at];
    let markup: string;
    if (g === undefined) markup = text + "#[|]#";
    else markup = chars.slice(0, at).join("") + "#[" + g + "|]#" + chars.slice(at + 1).join("");
    if (markup.includes("#[") === false || /#\[|\]#|#\(|\)#/.test(text)) continue;
    const kc = 1 + Math.floor(r() * 6);
    let keys = "";
    for (let k = 0; k < kc; k++) keys += pick(KEYS);
    cases.push({ id: `fuzz${seed}-${i}`, in: markup, keys });
  }
  return cases;
}

const MD_LINES = [
  "# ", "## ", "- ", "  - ", "1. ", "> ", "- [ ] ", "| a | b |", "|---|---|", "```", "```md", "```js", "---", "***", "    ", "",
];
const MD_WORDS = [
  "foo", "bar", "*it*", "**bold**", "_u_", "`code`", "[a](b)", "[[wiki]]", "(", ")", "[", "]", "{", "}", "\"", "'", "‘", "’",
  "“", "”", "«", "»", "x", "  ", "<b>", "</b>", "$m$", "~~s~~", "café", "мир", "👋🏽", "\\*", "#tag", "a.b", ",", "|",
];
const MD_KEYS = [
  "<A-o>", "<A-i>", "<A-n>", "<A-p>", "<A-a>", "<A-I>", "<A-e>", "<A-b>", "v<A-e>", "v<A-b>", "mm", "mim", "mam", "mi(", "ma\"",
  "md(", "mdm", "mr([", "mrm'", "]f", "[f", "i‘<esc>", "i“<esc>", "i(<esc>", "i`<esc>", "i\"<esc>", "i<backspace><esc>",
  "w", "b", "e", "x", "j", "k", "l", "h", "%", ";", "d", "c<esc>", "u", "<A-.>", "v", "<esc>", "2", "o<esc>", "yp", "J",
];

export function markdownFuzzSuite(n: number, seed: number): Case[] {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const cases: Case[] = [];
  for (let i = 0; i < n; i++) {
    const lines: string[] = [];
    const lineCount = 1 + Math.floor(r() * 6);
    for (let l = 0; l < lineCount; l++) {
      const wc = Math.floor(r() * 5);
      const parts: string[] = [];
      for (let w = 0; w < wc; w++) parts.push(pick(MD_WORDS));
      lines.push(pick(MD_LINES) + parts.join(r() < 0.7 ? " " : ""));
    }
    let text = lines.join("\n");
    if (r() < 0.85) text += "\n";
    const chars = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((g) => g.segment);
    const at = Math.floor(r() * Math.max(1, chars.length));
    const g = chars[at];
    const markup = g === undefined ? text + "#[|]#" : chars.slice(0, at).join("") + "#[" + g + "|]#" + chars.slice(at + 1).join("");
    if (/#\[|\]#|#\(|\)#/.test(text)) continue;
    const kc = 1 + Math.floor(r() * 4);
    let keys = "";
    for (let k = 0; k < kc; k++) keys += pick(MD_KEYS);
    cases.push({ id: `mdfuzz${seed}-${i}`, in: markup, keys, lang: "markdown" });
  }
  return cases;
}
