import { loadCache } from "../oracle/oracle";
import { handSuite } from "../oracle/suites";
import { parseMacro } from "../../src/keys";
import { openScratch, sendKeys, setDoc, api } from "./obsidian";

interface S {
  text: string;
  ranges: [number, number][];
  primary: number;
  mode: string;
  markup: string;
  native: [number, number][];
}

const EXCLUDE = /<C-c>|<space>c|<space>C|<space><A-c>|"%p|(^|[^g])[jk]|<up>|<down>|<C-[udbf]>|<pageup>|<pagedown>|<ret>(?!.*<esc>)|i<ret>|a<ret>|<tab>|<backspace>|<S-tab>|\{<ret>|<C-j>/;
const texts = (process.argv[2] ?? "words,code,unicode").split(",");
const cache = loadCache();
const cases = handSuite().filter((c) => texts.some((t) => c.id.startsWith(t + "#")) && !EXCLUDE.test(c.keys));
openScratch();
api("a.useConfig('')");
let pass = 0;
const fails: string[] = [];
for (const c of cases) {
  const expected = cache[`${c.in}\u0000${c.keys}`];
  if (!expected || expected.error || expected.text === undefined) continue;
  if (expected.text === "\n" && c.in !== "#[\n|]#") continue;
  setDoc(c.in);
  sendKeys(parseMacro(c.keys));
  const s = api<S>("a.state()");
  const ok =
    s.text === expected.text && JSON.stringify(s.ranges) === JSON.stringify(expected.ranges) && s.primary === expected.primary && s.mode === expected.mode;
  if (ok) pass++;
  else fails.push(`${JSON.stringify(c.keys)} in ${JSON.stringify(c.in)}\n  want ${JSON.stringify(expected.out)} ${expected.mode}\n  got  ${JSON.stringify(s.markup)} ${s.mode}`);
  if (s.mode !== "normal") sendKeys(["esc", "esc"]);
}
console.log(fails.slice(0, Number(process.env.SHOW ?? 40)).join("\n"));
api("a.useConfig(null)");
console.log(`\n${pass} pass, ${fails.length} fail of ${pass + fails.length}`);
