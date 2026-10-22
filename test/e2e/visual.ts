import { parseMacro } from "../../src/keys";
import { ob, openScratch, sendKeys, setDoc } from "./obsidian";

openScratch();
const shots: [string, string, string][] = [
  ["normal", "# Heading\n\nSome **bold** text and a [[link]] here.\n- list #[i|]#tem one\n- list item two\n", ""],
  ["multi", "alpha beta gamma\nalpha beta gamma\nalpha beta gamma\n#[a|]#lpha beta gamma\n", "<A-C><A-C>w"],
  ["select", "The quick #[b|]#rown fox jumps over the lazy dog.\nSecond line.\n", "vwwj"],
  ["insert", "The quick #[b|]#rown fox.\n", "i"],
  ["prompt", "The quick #[b|]#rown fox.\n", ":so"],
  ["space", "The quick #[b|]#rown fox.\n", "<space>"],
  ["eol", "line one#[\n|]#\n\nline three\n", ""],
];
for (const [name, doc, keys] of shots) {
  setDoc(doc);
  if (keys) sendKeys(parseMacro(keys));
  Bun.sleepSync(250);
  ob("dev:screenshot", `path=/tmp/hm-vis-${name}.png`);
  sendKeys(["esc", "esc", "esc"]);
}
