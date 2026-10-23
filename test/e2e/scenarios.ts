import { parseMacro } from "../../src/keys";
import { api, domKey, evalJs, ob, openScratch, sendDomKey, sendKeys, setDoc, state, type AppState } from "./obsidian";

type Check = { name: string; run: () => void };
const results: { name: string; ok: boolean; detail: string }[] = [];

function keys(k: string): void {
  sendKeys(parseMacro(k));
}

function expectEq<T>(what: string, got: T, want: T): void {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

function expectTrue(what: string, cond: boolean, detail = ""): void {
  if (!cond) throw new Error(`${what} ${detail}`);
}

function consistent(s: AppState & { ranges: [number, number][] }): void {
  if (s.mode === "insert") return;
  const text = (s as unknown as { text: string }).text;
  const toUtf16 = (c: number) => [...text].slice(0, c).join("").length;
  const want = s.ranges.map(([a, h]) => [toUtf16(a), toUtf16(h)]);
  expectEq("native selection mirrors Helix ranges", s.native, want);
}

function dom(code: string): unknown {
  return evalJs(`JSON.stringify((()=>{const v=app.plugins.plugins["helix-motions"].api.view(); ${code}})())`);
}

const checks: Check[] = [
  {
    name: "normal mode: printable keys never insert text",
    run: () => {
      setDoc("#[h|]#ello world\n");
      keys("zZqQ!@");
      const s = state();
      expectEq("text", (s as unknown as { text: string }).text.startsWith("hello world"), true);
    },
  },
  {
    name: "Esc leaves insert mode through the real key path",
    run: () => {
      setDoc("#[h|]#ello\n");
      keys("i");
      expectEq("mode", state().mode, "insert");
      keys("<esc>");
      expectEq("mode", state().mode, "normal");
    },
  },
  {
    name: "native typing in insert mode keeps Helix range semantics",
    run: () => {
      setDoc("#[h|]#ello\n");
      keys("iab<esc>");
      expectEq("markup", state().markup, "ab#[|h]#ello\n");
    },
  },
  {
    name: "Russian layout: physical keys drive normal mode",
    run: () => {
      setDoc("#[h|]#ello world\n");
      sendDomKey({ key: "д", code: "KeyL", text: "д", keyCode: 76, modifiers: 0 });
      sendDomKey({ key: "у", code: "KeyE", text: "у", keyCode: 69, modifiers: 0 });
      const s = state();
      expectEq("markup", s.markup, "h#[ello|]# world\n");
    },
  },
  {
    name: "Russian layout: f waits for the real character",
    run: () => {
      setDoc("#[п|]#ривет мир\n");
      sendDomKey({ key: "а", code: "KeyF", text: "а", keyCode: 70, modifiers: 0 });
      sendDomKey({ key: "м", code: "KeyV", text: "м", keyCode: 86, modifiers: 0 });
      expectEq("markup", state().markup, "#[привет м|]#ир\n");
    },
  },
  {
    name: "Russian layout: insert mode types Cyrillic",
    run: () => {
      setDoc("#[x|]#\n");
      keys("i");
      sendDomKey({ key: "о", code: "KeyJ", text: "о", keyCode: 74, modifiers: 0 });
      keys("<esc>");
      expectEq("text", (state() as unknown as { text: string }).text, "оx\n");
    },
  },
  {
    name: "Cmd shortcuts go to Obsidian (Cmd-B bolds the selection)",
    run: () => {
      setDoc("#[hello|]# world\n");
      sendDomKey({ ...domKey("b"), modifiers: 4, text: undefined });
      const s = state() as AppState & { text: string; ranges: [number, number][] };
      expectEq("text", s.text, "**hello** world\n");
      expectEq("mode", s.mode, "normal");
      consistent(s);
    },
  },
  {
    name: "Live Preview reveals markup inside the Helix selection",
    run: () => {
      ob("eval", 'code=app.workspace.getActiveViewOfType(require("obsidian").MarkdownView).setState({mode:"source",source:false},{history:false})');
      setDoc("plain #[t|]#ext and **bold** end\n");
      const hidden = dom("return v.contentDOM.innerText.includes('**')") as boolean;
      expectEq("markup hidden while selection is outside", hidden, false);
      keys("fb");
      const shown = dom("return v.contentDOM.innerText.includes('**')") as boolean;
      expectEq("markup shown when selection touches it", shown, true);
    },
  },
  {
    name: "o continues a markdown list (decision 3)",
    run: () => {
      setDoc("- #[i|]#tem one\n");
      keys("otwo<esc>");
      expectEq("text", (state() as unknown as { text: string }).text, "- item one\n- two\n");
    },
  },
  {
    name: "o continues numbered lists and tasks",
    run: () => {
      setDoc("1. #[f|]#irst\n- [x] done\n");
      keys("ob<esc>jjoc<esc>");
      expectEq("text", (state() as unknown as { text: string }).text, "1. first\n2. b\n- [x] done\n- [ ] c\n");
    },
  },
  {
    name: "Enter in insert mode is Obsidian's (list continuation)",
    run: () => {
      setDoc("- #[i|]#tem\n");
      keys("A<ret>next<esc>");
      expectEq("text", (state() as unknown as { text: string }).text, "- item\n- next\n");
    },
  },
  {
    name: "Tab in insert mode is Obsidian's (indents list item)",
    run: () => {
      setDoc("- one\n- #[t|]#wo\n");
      keys("i<tab><esc>");
      const t = (state() as unknown as { text: string }).text;
      expectTrue("second item indented", /\n(\t|    )- two/.test(t), JSON.stringify(t));
    },
  },
  {
    name: "insert session undoes as one step",
    run: () => {
      setDoc("#[x|]#\n");
      keys("ihello world<esc>");
      keys("u");
      expectEq("markup", state().markup, "#[|x]#\n");
    },
  },
  {
    name: "command prompt runs typed commands",
    run: () => {
      setDoc("#[x|]#\n");
      keys(":echo hello there<ret>");
      expectEq("status", state().status?.message, "hello there");
    },
  },
  {
    name: "prompt panel is visible while typing",
    run: () => {
      setDoc("#[x|]#\n");
      keys(":ech");
      const text = dom("return v.dom.querySelector('.hx-prompt')?.innerText") as string;
      keys("<esc>");
      expectTrue("prompt shows input", typeof text === "string" && text.includes("ech"), JSON.stringify(text));
    },
  },
  {
    name: "search selects the next match",
    run: () => {
      setDoc("#[a|]#bc world abc world\n");
      keys("/wor<ret>n");
      expectEq("markup", state().markup, "abc world abc #[wor|]#ld\n");
    },
  },
  {
    name: "space menu shows the which-key panel",
    run: () => {
      setDoc("#[x|]#\n");
      keys("<space>");
      const info = dom("return v.dom.querySelector('.hx-autoinfo')?.innerText") as string;
      keys("<esc>");
      expectTrue("autoinfo lists file picker", typeof info === "string" && /file picker/i.test(info), JSON.stringify(info?.slice(0, 80)));
    },
  },
  {
    name: "Kote's config: jk leaves insert mode",
    run: () => {
      setDoc("#[x|]#\n");
      keys("iajk");
      const s = state() as AppState & { text: string };
      expectEq("mode", s.mode, "normal");
      expectEq("text", s.text, "ax\n");
    },
  },
  {
    name: "Kote's config: j then other key inserts both",
    run: () => {
      setDoc("#[x|]#\n");
      keys("ijo<esc>");
      expectEq("text", (state() as unknown as { text: string }).text, "jox\n");
    },
  },
  {
    name: "Kote's config: w runs the @miw macro",
    run: () => {
      setDoc("hello wo#[r|]#ld again\n");
      keys("w");
      expectEq("markup", state().markup, "hello #[world|]# again\n");
    },
  },
  {
    name: "multiple cursors map to multiple native ranges",
    run: () => {
      setDoc("#[a|]#bc\ndef\nghi\n");
      keys("CC");
      const s = state();
      expectEq("native count", s.native.length, 3);
      consistent(s as AppState & { ranges: [number, number][] });
    },
  },
  {
    name: "mouse click puts a 1-wide Helix range under the pointer",
    run: () => {
      setDoc("#[h|]#ello world\n");
      const coords = dom("const c=v.coordsAtPos(7); return [c.left+2,(c.top+c.bottom)/2]") as [number, number];
      ob("dev:cdp", "method=Input.dispatchMouseEvent", `params=${JSON.stringify({ type: "mousePressed", x: coords[0], y: coords[1], button: "left", clickCount: 1 })}`);
      ob("dev:cdp", "method=Input.dispatchMouseEvent", `params=${JSON.stringify({ type: "mouseReleased", x: coords[0], y: coords[1], button: "left", clickCount: 1 })}`);
      const s = state();
      expectEq("markup", s.markup, "hello w#[o|]#rld\n");
      consistent(s as AppState & { ranges: [number, number][] });
    },
  },
  {
    name: "paste in normal mode pastes before the selection",
    run: () => {
      setDoc("abc #[d|]#ef\n");
      dom("const dt=new DataTransfer(); dt.setData('text/plain','XY'); v.contentDOM.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true})); return true");
      expectEq("markup", state().markup, "abc #[XY|]#def\n");
    },
  },
  {
    name: "space y yanks to the system clipboard",
    run: () => {
      setDoc("abc #[def|]#\n");
      keys("<space>y");
      expectEq("clipboard", evalJs<string>('JSON.stringify(require("electron").clipboard.readText())'), "def");
    },
  },
  {
    name: "status bar shows the mode",
    run: () => {
      setDoc("#[x|]#\n");
      const nor = evalJs<string>("JSON.stringify(document.querySelector('.hx-status')?.innerText)");
      keys("i");
      const ins = evalJs<string>("JSON.stringify(document.querySelector('.hx-status')?.innerText)");
      keys("<esc>");
      expectTrue("NOR then INS", nor.includes("NOR") && ins.includes("INS"), `${nor} / ${ins}`);
    },
  },
  {
    name: "relative line numbers follow the cursor",
    run: () => {
      setDoc("a\nb\n#[c|]#\nd\ne\n");
      const nums = dom("return [...v.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].map(e=>e.innerText).filter(t=>t)") as string[];
      expectTrue("numbers", nums.join(",").startsWith("2,1,3,1,2"), JSON.stringify(nums));
    },
  },
  {
    name: "goto word labels appear and jump",
    run: () => {
      setDoc("#[a|]#lpha beta gamma\n");
      keys("gw");
      const labels = dom("return [...v.dom.querySelectorAll('.hx-jump-label')].map(e=>e.innerText).join('')") as string;
      expectTrue("labels drawn", labels.length >= 4, JSON.stringify(labels));
      keys("aa");
      expectEq("markup", state().markup, "alpha #[beta|]# gamma\n");
    },
  },
  {
    name: "space f opens the quick switcher",
    run: () => {
      setDoc("#[x|]#\n");
      keys("<space>f");
      const open = evalJs<boolean>("JSON.stringify(!!document.querySelector('.prompt'))");
      keys("<esc>");
      evalJs("JSON.stringify(document.querySelector('.prompt') ? (document.querySelector('.modal-container')?.remove(), true) : false)");
      expectEq("switcher open", open, true);
    },
  },
  {
    name: "gd follows a wiki link and C-o comes back",
    run: () => {
      setDoc("see [[notes/Sec#[o|]#nd]] here\n");
      keys("gd");
      const path = () => evalJs<string>("JSON.stringify(app.workspace.getActiveFile()?.path)");
      for (let i = 0; i < 20 && path() !== "notes/Second.md"; i++) Bun.sleepSync(100);
      expectEq("opened", path(), "notes/Second.md");
      keys("<C-o>");
      for (let i = 0; i < 20 && path() !== "scratch.md"; i++) Bun.sleepSync(100);
      expectEq("back", path(), "scratch.md");
      expectEq("selection restored", state().markup, "see [[notes/Sec#[o|]#nd]] here\n");
    },
  },
  {
    name: "C-w v splits and C-w q closes",
    run: () => {
      setDoc("#[x|]#\n");
      const count = () => evalJs<number>("JSON.stringify(app.workspace.getLeavesOfType('markdown').length)");
      const before = count();
      keys("<C-w>v");
      Bun.sleepSync(300);
      expectEq("after split", count(), before + 1);
      keys("<C-w>q");
      Bun.sleepSync(300);
      expectEq("after close", count(), before);
    },
  },
  {
    name: ":open opens a note and gn/gp move between tabs",
    run: () => {
      setDoc("#[x|]#\n");
      const path = () => evalJs<string>("JSON.stringify(app.workspace.getActiveFile()?.path)");
      evalJs("JSON.stringify((app.workspace.getLeaf('tab').openFile(app.vault.getAbstractFileByPath('Welcome.md')), true))");
      Bun.sleepSync(400);
      evalJs("JSON.stringify((app.workspace.setActiveLeaf(app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path==='scratch.md'),{focus:true}), true))");
      Bun.sleepSync(200);
      keys("gn");
      Bun.sleepSync(300);
      const next = path();
      keys("gp");
      Bun.sleepSync(300);
      const prev = path();
      evalJs("JSON.stringify((app.workspace.getLeavesOfType('markdown').filter(l=>l.view.file?.path==='Welcome.md').forEach(l=>l.detach()), true))");
      expectEq("gn", next, "Welcome.md");
      expectEq("gp", prev, "scratch.md");
    },
  },
  {
    name: ":w saves and applies trim-trailing-whitespace",
    run: () => {
      setDoc("#[a|]#bc   \n");
      keys(":w<ret>");
      Bun.sleepSync(400);
      const disk = evalJs<string>("JSON.stringify(require('fs').readFileSync(app.vault.adapter.getFullPath('scratch.md'),'utf8'))");
      expectEq("disk", disk, "abc\n");
    },
  },
  {
    name: "space k shows a page preview for the link",
    run: () => {
      setDoc("see [[notes/Sec#[o|]#nd]] here\n");
      keys("<space>k");
      let shown = false;
      for (let i = 0; i < 20 && !shown; i++) {
        shown = evalJs<boolean>("JSON.stringify(!!document.querySelector('.hover-popover'))");
        if (!shown) Bun.sleepSync(100);
      }
      expectEq("popover", shown, true);
      keys("l");
      let gone = false;
      for (let i = 0; i < 30 && !gone; i++) {
        gone = !evalJs<boolean>("JSON.stringify(!!document.querySelector('.hover-popover'))");
        if (!gone) Bun.sleepSync(100);
      }
      expectEq("popover closes on next key", gone, true);
    },
  },
  {
    name: ":open completes vault paths with Tab",
    run: () => {
      setDoc("#[x|]#\n");
      const path = () => evalJs<string>("JSON.stringify(app.workspace.getActiveFile()?.path)");
      keys(":o notes/Se<tab><ret>");
      for (let i = 0; i < 20 && path() !== "notes/Second.md"; i++) Bun.sleepSync(100);
      const got = path();
      openScratch();
      expectEq("opened", got, "notes/Second.md");
    },
  },
  {
    name: "unsupported Helix commands report status instead of crashing",
    run: () => {
      setDoc("#[x|]#\n");
      keys("<A-o>");
      const s = state();
      expectTrue("status set", !!s.status && /not available/.test(s.status.message), JSON.stringify(s.status));
    },
  },
];

openScratch();
const only = process.argv[2];
for (const check of checks) {
  if (only && !check.name.includes(only)) continue;
  try {
    check.run();
    results.push({ name: check.name, ok: true, detail: "" });
  } catch (err) {
    results.push({ name: check.name, ok: false, detail: (err as Error).message });
  }
  try {
    const s = state();
    if (s.mode !== "normal" || s.prompt) keys("<esc><esc>");
  } catch {}
}
for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}${r.ok ? "" : `\n     ${r.detail}`}`);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} scenarios pass`);
void api;
