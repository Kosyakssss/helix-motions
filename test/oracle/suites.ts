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
