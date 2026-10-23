import type { Case } from "./oracle";

const TEXTS = {
  words: "#[h|]#ello world, foo_bar baz-qux 123 4.5\nsecond line here\n",
  code: "fn main() {\n    let x = (a + [b, c]) * {d};\n    println!(\"hi {}\", x);\n}\n#[|\n]#",
  prose: "#[T|]#he quick brown fox.\n\nJumps over the lazy dog.\nAnd again.\n\n\nLast paragraph here.\n",
  unicode: "#[п|]#ривет мир 👋🏽 café naïve 漢字テスト é\n🇬🇪 flag and ﬁ ligature\n",
  tabs: "\t#[i|]#ndented\n\t\tdeeper\nnone\n    four spaces\n",
  empty: "#[\n|]#",
  noeol: "abc #[d|]#ef",
  multi: "#[a|]#bc #(d|)#ef #(g|)#hi\njkl mno pqr\n",
  backward: "hello #[|world]# again\n",
  lines: "one\ntwo\n#[t|]#hree\nfour\nfive\nsix\n",
  quotes: "say \"#[h|]#ello\" and 'bye' `tick` (paren [brack {brace}])\n",
  camel: "#[f|]#ooBarBaz someHTTPServer snake_case_name\n",
  numbers: "#[4|]#2 -7 0x1F 0b101 0o17 2021-11-24 007 1_000\n",
  markdown: "# Head#[i|]#ng\n\n- item one\n- item two\n  - nested\n1. first\n> quote line\n**bold** and *it* [[Link|alias]] `code`\n",
};

const MOTIONS = [
  "h", "l", "j", "k", "3l", "2j", "w", "b", "e", "W", "B", "E", "3w", "5b", "2e",
  "gh", "gl", "gs", "ge", "gg", "3gg", "G", "4G", "g|", "5g|", "<home>", "<end>",
  "gj", "gk", "2gj", "]p", "[p", "2]p",
  "fo", "Fo", "to", "To", "2fo", "f<ret>", "t<ret>", "F<ret>", "T<ret>", "f<space>", "fz",
  "x", "2x", "xx", "X", "<A-x>", "%", ";", "<A-;>", "<A-:>", ",", "<A-,>",
  "C", "<A-C>", "3C", "<A-s>", "<A-minus>", "<A-_>", "_", "&", "(", ")", "<A-(>", "<A-)>",
  "mm", "miw", "maw", "miW", "maW", "mip", "map", "mi(", "ma(", "mi[", "mi{", "mi\"", "ma\"", "mi'", "mim", "mam", "2mi(",
  "vl", "vw", "vj", "vgl", "vfo", "v3l", "vx", "v<esc>",
  "v2wd", "wvbd",
];

const EDITS = [
  "d", "<A-d>", "c<esc>", "cXY<esc>", "ifoo<esc>", "afoo<esc>", "Ifoo<esc>", "Afoo<esc>",
  "o<esc>", "O<esc>", "ofoo<esc>", "Ofoo<esc>", "3ox<esc>", "ra", "r<ret>", "r<tab>", "~", "`", "<A-`>",
  "yp", "yP", "y3p", "xyp", "xyP", "ywP", "dp", "xdp", "R", "yR", "wyhR",
  "<gt>", "<lt>", "x<gt>", "x<lt>", "2<gt>", "J", "xJ", "<A-J>", "xxxJ",
  "u", "U", "duu", "dU", "duU", "ifoo<esc>u", "ifoo<esc>uU", "ddu", "<A-u>", "<A-U>", "dd<A-u><A-U>",
  "<C-a>", "<C-x>", "5<C-a>", "e<C-a>", "x<C-a>", "wb<C-x>",
  "ms(", "ms\"", "msm", "ms<ret>", "mr([", "md(", "mr\"'", "mdm", "mrm{", "ms<lt>", "mr(<gt>",
  "]<space>", "[<space>", "2]<space>",
  "ix<C-w><esc>", "ifoo bar<C-w><esc>", "ifoo<C-u><esc>", "ifoo<C-k><esc>", "i<C-d><esc>", "i<del><esc>",
  "i<backspace><esc>", "a<backspace><esc>", "ifoo<backspace><backspace><esc>", "i<A-d><esc>", "i<A-backspace><esc>",
  "i(<esc>", "i[x<esc>", "i\"<esc>", "a(<esc>", "i()<esc>", "i(<backspace><esc>", "i{<ret><esc>",
  "i<ret><esc>", "a<ret><esc>", "i<tab><esc>", "i<S-tab><esc>", "i<C-j><esc>",
  "ifoo<esc>.", "afoo<esc>w.", "cbar<esc>w.", "ofoo<esc>.", "ifoo<esc>3.",
  "Qiab<esc>Qq", "Qwq", "QdQ2q", "\"aQihi<esc>Q\"aq",
  "\"ayw\"ap", "\"_d", "\"ayy\"bP", "\"#p", "\".p", "\"%p",
  "<C-c>", "x<C-c>", "<space>c", "<space>C", "<space><A-c>",
  "<C-s>w<C-o>", "w<C-s>bb<C-o><C-i>", "ggG<C-o>", "gg<C-o><C-i>",
  "<A-.>", "fo;<A-.>", "mi(<A-.>",
  "%<A-s>&", "x<A-s>_", "%s<space><ret>d", "%s\\w+<ret>", "%So<ret>", "%sl+<ret>y", "%Ko<ret>", "%<A-K>o<ret>", "%S\\n<ret>",
  "/o<ret>", "/o<ret>n", "/o<ret>N", "?o<ret>", "?o<ret>n", "/zzz<ret>", "*n", "<A-*>n", "w*N", "/O<ret>", "/l+<ret>nn",
  "%s<ret>", "/<ret>", "/e<ret>/<ret>",
  ":5<ret>", ":sort<ret>", "%<A-s>:sort<ret>", "%<A-s>:sort -r<ret>", ":echo hi<ret>",
  "x:reflow 10<ret>", "%:reflow 8<ret>", ":char<ret>", ":set-register a hi<ret>\"ap",
  "ifoo<esc>:earlier<ret>", "ifoo<esc>u:later<ret>", ":clear-register<ret>",
  "<C-r>", "ix<C-r>\"<esc>", "yi<C-r>\"<esc>",
];

export function handSuite(): Case[] {
  const cases: Case[] = [];
  let n = 0;
  for (const [name, text] of Object.entries(TEXTS)) {
    for (const keys of [...MOTIONS, ...EDITS]) {
      cases.push({ id: `${name}#${n++}`, in: text, keys });
    }
  }
  return cases;
}

const MD_TEXTS = [
  "# Heading one\n\nSome *emphasis* and **strong** text with `code` here.\n\n## Second (part)\n\n- item one\n- item [two](http://x.y)\n  - nested *a*\n- [ ] task\n",
  "---\ntitle: Note\ntags: [a, b]\n---\n\n# Title\n\nParagraph with [[Wiki link|alias]] and ![[embed.png]].\n",
  "> quote line one *with* emphasis\n> second line (paren)\n>\n> - list in quote\n\nAfter.\n",
  "```js\nconst x = (a + [b, c]) * {d};\n```\n\n```md\n# inner *head*\n- li\n```\n\nText (with [nested {brackets}]) end.\n",
  "| col a | col *b* |\n|---|:---:|\n| `x` | [y](z) |\n| 1 | 2 |\n\nTable done.\n",
  "1. first **bold _nested_ text**\n2. second\n   1. deep (one)\n3. third\n\n***\n\nLast \"quoted\" 'single' line.\n",
  "Line with <span>html</span> and $x^2$ math and ~~strike~~ and ==mark==.\n<div>\nblock html\n</div>\n",
  "Setext heading\n===\n\nAnother\n---\n\n    indented code (x)\n\n- a\n\n  continued para\n- b\n",
  "Привет **мир** 👋🏽 café *naïve* `漢字`\n\n- [x] done «quote» “smart”\n",
  "> ```md\n> # q *x*\n> ```\n\nfoo(bar[baz]{qux})\n",
  "#[",
  "plain paragraph without anything special\nsecond line of it\n",
];

const MD_KEYS = [
  "<A-o>", "<A-o><A-o>", "<A-o><A-o><A-o>", "<A-o><A-o><A-o><A-o><A-o><A-o>", "<A-o><A-i>", "<A-o><A-o><A-i><A-i>",
  "<A-i>", "<A-i><A-i>", "<A-n>", "<A-p>", "<A-o><A-n>", "<A-o><A-p>", "<A-o><A-o><A-n><A-n>", "<A-a>", "<A-o><A-a>",
  "<A-I>", "<A-o><A-o><A-I>", "<A-e>", "<A-b>", "<A-b><A-b>", "<A-e><A-e>", "v<A-e>", "v<A-b>", "vl<A-b><A-b>",
  "x<A-o>", "w<A-o>", "<A-o>d", "<A-o><A-.>", "%<A-i>", "%<A-I>",
  "mm", "lmm", "mmmm", "vmm", "mim", "mam", "2mim", "mi(", "ma(", "mi[", "mi\"", "ma\"", "mi`", "ma*", "md(", "mdm", "mr([", "mrm\"",
  "]f", "[f", "]t", "v]f", "vh[f", "]c", "mif", "mac",
  "i(<esc>", "i‘<esc>", "i“<esc>", "i«<esc>", "i`<esc>", "o‘<esc>", "A“<esc>", "i\"<esc>", "i(<backspace><esc>", "i“<backspace><esc>",
  "i<ret><esc>", "o<esc>", "w<gt>", "x<lt>",
];

function graphemeStarts(text: string): number[] {
  const starts: number[] = [];
  for (const seg of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) starts.push(seg.index);
  return starts;
}

export function markdownSuite(): Case[] {
  const cases: Case[] = [];
  let n = 0;
  for (const raw of MD_TEXTS) {
    const text = raw === "#[" ? "" : raw;
    const starts = graphemeStarts(text);
    const picks = new Set<number>();
    const want = Math.min(12, Math.max(1, starts.length));
    for (let i = 0; i < want; i++) picks.add(starts.length === 0 ? 0 : starts[Math.floor((i * starts.length) / want)]!);
    for (const at of picks) {
      if (text[at - 1] === "#") continue;
      const end = starts.find((s) => s > at) ?? text.length;
      const markup = text.length === 0 ? "#[|]#" : text.slice(0, at) + "#[" + text.slice(at, end) + "|]#" + text.slice(end);
      for (const keys of MD_KEYS) cases.push({ id: `md#${n++}`, in: markup, keys, lang: "markdown" });
    }
  }
  return cases;
}
