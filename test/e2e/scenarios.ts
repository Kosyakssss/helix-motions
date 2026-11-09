import { parseMacro } from "helix-cm6/engine";
import { api, domKey, evalJs, mouse, ob, openScratch, sendDomKey, sendKeys, setDoc, state, type AppState } from "./obsidian";

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
  const want = s.ranges.map(([a, h]) => {
    const end = Math.max(a, h);
    const last = [...text][end - 1] === "\n" && end > Math.min(a, h) ? end - 1 : end;
    return [toUtf16(Math.min(a, last)), toUtf16(Math.min(h, last))];
  });
  expectEq("native selection mirrors Helix ranges", s.native, want);
}

function dom(code: string): unknown {
  return evalJs(`JSON.stringify((()=>{const v=app.plugins.plugins["helix-motions"].api.view(); ${code}})())`);
}


function cursorLine(): number {
  return dom(`const value = v.state.doc.lineAt(v.state.selection.main.anchor); return value.number`) as number;
}

function cell(): [number, number, string] | null {
  return evalJs(`JSON.stringify((()=>{const c=app.workspace.activeLeaf.view.editor.editorComponent.tableCell;return c?[c.cell.row,c.cell.col,c.editor.cm.state.doc.toString()]:null})())`);
}

function cellsSelected(): number {
  return evalJs(`JSON.stringify((()=>{const c=app.workspace.activeLeaf.view.editor.editorComponent.tableCell;return c?c.table.selectedCells.length:0})())`);
}

function note(): string {
  return evalJs(`JSON.stringify(app.workspace.activeLeaf.view.editor.cm.state.doc.toString())`);
}

function tableKeys(k: string): void {
  sendKeys(parseMacro(k));
  Bun.sleepSync(250);
}

const TABLE = "#[a|]#bove\n\n| h1 | h2 | h3 |\n| -- | -- | -- |\n| a  | bb | c  |\n| d  | ee | f  |\n\nbelow\n";

function inTable(): void {
  setDoc(TABLE);
  Bun.sleepSync(500);
  tableKeys("jj");
}

function tableScenarios(): Check[] {
  return [
    {
      name: "table: j from above enters the header, k from below enters the last row",
      run: () => {
        inTable();
        expectEq("header", cell()?.slice(0, 2), [0, 0]);
        tableKeys("3j");
        expectEq("left below", cell(), null);
        expectEq("line", cursorLine() > 6, true);
        tableKeys("k");
        expectEq("last row", cell()?.[0], 2);
      },
    },
    {
      name: "table: h and l cross cells but not past the row, and counts go across cells",
      run: () => {
        inTable();
        tableKeys("h");
        expectEq("stays at the first cell", cell()?.slice(0, 2), [0, 0]);
        tableKeys("ll");
        expectEq("second cell", cell()?.slice(0, 2), [0, 1]);
        tableKeys("9l");
        expectEq("clamped at the last cell", cell()?.slice(0, 2), [0, 2]);
        tableKeys("9l");
        expectEq("stays", cell()?.slice(0, 2), [0, 2]);
        tableKeys("h");
        tableKeys("h");
        expectEq("back one cell", cell()?.[1], 1);
      },
    },
    {
      name: "table: h lands on the last letter of the cell to the left, j and k keep the letter",
      run: () => {
        inTable();
        tableKeys("j");
        tableKeys("l");
        expectEq("next cell", cell()?.slice(0, 2), [1, 1]);
        const head = () => evalJs<number>(`JSON.stringify(app.workspace.activeLeaf.view.editor.editorComponent.tableCell.editor.cm.state.selection.main.head)`);
        tableKeys("l");
        expectEq("second letter", head(), 2);
        tableKeys("k");
        expectEq("same letter above", head(), 2);
        tableKeys("gh");
        tableKeys("h");
        expectEq("left cell", cell()?.slice(0, 2), [0, 0]);
        expectEq("last letter", head(), 2);
      },
    },
    {
      name: "table: moving between cells does not shift the layout, and a selection in a cell is visible",
      run: () => {
        setDoc(TABLE);
        Bun.sleepSync(500);
        const height = () => evalJs<number>(`JSON.stringify(document.querySelector(".cm-table-widget").getBoundingClientRect().height)`);
        const before = height();
        tableKeys("jj");
        expectEq("entering the table", height(), before);
        tableKeys("l");
        tableKeys("j");
        expectEq("moving in the table", height(), before);
        tableKeys("mi|");
        const shown = evalJs<string>(`JSON.stringify(getComputedStyle(app.workspace.activeLeaf.view.editor.editorComponent.tableCell.editor.cm.dom.querySelector(".cm-line"), "::selection").backgroundColor)`);
        expectEq("selection colour", shown !== "rgba(0, 0, 0, 0)" && shown !== "transparent", true);
      },
    },
    {
      name: "table: several cursors cross cells on their own and stop at the table's edge",
      run: () => {
        const at = () => evalJs<number[][]>(`JSON.stringify((()=>{const c=app.workspace.activeLeaf.view.editor.editorComponent.tableCell;const out=[[c.cell.row,c.cell.col]];for(const m of document.querySelectorAll(".hx-cell-cursors .hx-cell")){const b=m.getBoundingClientRect();const y=b.top+b.height/2;const x=b.left+1;for(const x2 of c.table.rows.flat()){const r=x2.el.getBoundingClientRect();if(x>=r.left&&x<r.right&&y>=r.top&&y<r.bottom)out.push([x2.row,x2.col])}}return out.sort((p,q)=>p[0]-q[0]||p[1]-q[1])})())`);
        inTable();
        tableKeys("j");
        tableKeys("C");
        expectEq("start", at(), [[1, 0], [2, 0]]);
        tableKeys("l");
        expectEq("l crosses", at(), [[1, 1], [2, 1]]);
        tableKeys("9l");
        expectEq("l stops at the end of the row", at(), [[1, 2], [2, 2]]);
        tableKeys("h");
        expectEq("h crosses back", at(), [[1, 1], [2, 1]]);
        tableKeys("<esc>");
        tableKeys(",");
        inTable();
        tableKeys("C");
        expectEq("two rows", at(), [[0, 0], [1, 0]]);
        tableKeys("e");
        expectEq("e: the second cursor is at its cell's end, so it crosses and the first stays", at(), [[0, 0], [1, 1]]);
        tableKeys("e");
        expectEq("e: the first crosses now", at()[0], [0, 1]);
        tableKeys("30e");
        expectEq("e goes on across rows, stops at the last cell, and the cursors merge", cell()?.slice(0, 2), [2, 2]);
        expectEq("one cursor left", evalJs(`JSON.stringify(document.querySelectorAll(".hx-cell-cursors .hx-cell").length)`), 0);
        inTable();
        tableKeys("C");
        tableKeys("2l");
        tableKeys("b");
        tableKeys("9b");
        expectEq("b stops at the first cell", cell()?.slice(0, 2), [0, 0]);
        tableKeys("<esc>");
        tableKeys(",");
      },
    },
    {
      name: "table: s on selected cells selects the matches inside them",
      run: () => {
        const doc = "#[a|]#bove\n\n| h1 | h2 |\n| -- | -- |\n| x needle y needle | b |\n| c | z needle two |\n\nbelow needle\n";
        setDoc(doc);
        Bun.sleepSync(500);
        tableKeys("jjj");
        tableKeys("ma|");
        tableKeys("x");
        tableKeys("x");
        expectEq("cells selected", cellsSelected(), 4);
        tableKeys("sneedle");
        tableKeys("<ret>");
        expectEq("no cell selection left", cellsSelected(), 0);
        const count = (selector: string) => evalJs<number>(`JSON.stringify(document.querySelectorAll("${selector}").length)`);
        expectEq("the other cell's match is drawn", count(".hx-cell-cursors .hx-cell"), 1);
        tableKeys("cQQ");
        tableKeys("<esc>");
        expectEq("all three changed, and the text outside stayed", note().replace(/ +/g, " "), "above\n\n| h1 | h2 |\n| --------- | -------- |\n| x QQ y QQ | b |\n| c | z QQ two |\n\nbelow needle\n");
        tableKeys(",");
        setDoc(doc);
        Bun.sleepSync(500);
        tableKeys("jjj");
        tableKeys("ma|");
        tableKeys("x");
        tableKeys("x");
        tableKeys("snomatch");
        tableKeys("<esc>");
        expectEq("cancel keeps a cursor in every cell", count(".hx-cell-cursors .hx-cell"), 3);
        tableKeys(",");
        setDoc(doc);
        Bun.sleepSync(500);
        tableKeys("jjj");
        tableKeys("ma|");
        tableKeys("sy");
        tableKeys("<ret>");
        expectEq("one cell, one match: selected in the cell", cell()?.slice(0, 2), [1, 0]);
        expectEq("selection", dom(`const c=app.workspace.activeLeaf.view.editor.editorComponent.tableCell.editor.cm;return c.state.sliceDoc(c.state.selection.main.from,c.state.selection.main.to)`), "y");
      },
    },
    {
      name: "table: a search match in a cell is selected there, and n walks through every match",
      run: () => {
        setDoc("#[a|]#bove\n\n| h1 | h2 |\n| -- | -- |\n| x needle y needle | b |\n| c | z needle two |\n\nbelow needle\n");
        Bun.sleepSync(500);
        const where = () => evalJs<unknown>(`JSON.stringify((()=>{const ed=app.workspace.activeLeaf.view.editor;const c=ed.editorComponent.tableCell;const v=c?c.editor.cm:ed.cm;const m=v.state.selection.main;return [c?[c.cell.row,c.cell.col]:null,m.from,v.state.sliceDoc(m.from,m.to)]})())`);
        tableKeys("/needle");
        tableKeys("<ret>");
        expectEq("first", where(), [[1, 0], 2, "needle"]);
        tableKeys("n");
        expectEq("second, same cell", where(), [[1, 0], 11, "needle"]);
        tableKeys("n");
        expectEq("third, other cell", where(), [[2, 1], 2, "needle"]);
        tableKeys("n");
        expectEq("below the table", (where() as [unknown, number, string])[0], null);
        tableKeys("N");
        expectEq("back into the cell", where(), [[2, 1], 2, "needle"]);
        tableKeys("N");
        expectEq("back again", where(), [[1, 0], 11, "needle"]);
      },
    },
    {
      name: "table: % then s shows every match in the cells",
      run: () => {
        const count = (selector: string) => evalJs<number>(`JSON.stringify(document.querySelectorAll("${selector}").length)`);
        const painted = () => [count(".hx-cell-cursors .hx-cell"), count(".hx-cell-cursors .hx-cell-primary"), count(".hx-cell-selections .hx-cell")];
        setDoc("#[a|]#bove\n\n| h1 | h2 |\n| -- | -- |\n| needle | b |\n| c | needle |\n\nbelow\n");
        Bun.sleepSync(500);
        tableKeys("%");
        tableKeys("sneedle");
        tableKeys("<ret>");
        expectEq("two in the table: both drawn, one is main", painted(), [2, 1, 2]);
        expectEq("focus stays on the note", cell(), null);
        tableKeys(")");
        expectEq("the main cursor moves", painted(), [2, 1, 2]);
        tableKeys("cQ");
        expectEq("the main cursor stays drawn in insert mode", painted()[1], 1);
        tableKeys("<esc>");
        expectEq("both changed", note(), "above\n\n| h1 | h2 |\n| -- | -- |\n| Q | b |\n| c | Q |\n\nbelow\n");
        tableKeys(",");
        expectEq("one left: nothing drawn from the note", painted(), [0, 0, 0]);
        expectTrue("and it is in a cell", cell() !== null);
        tableKeys("<esc>");
        setDoc("#[a|]#bove\n\n| h1 | h2 |\n| -- | -- |\n| needle | b |\n| c | needle |\n\nbelow needle\n");
        Bun.sleepSync(500);
        tableKeys("%");
        tableKeys("sneedle");
        tableKeys("<ret>");
        expectEq("also below the table: both cells still drawn", painted().slice(0, 1), [2]);
        tableKeys("<esc>");
        tableKeys(",");
        tableKeys("<esc>");
        setDoc("#[a|]#bove\n\n| h1 | h2 |\n| -- | -- |\n| x needle | b |\n\nbelow\n");
        Bun.sleepSync(500);
        tableKeys("%");
        tableKeys("sneedle");
        tableKeys("<ret>");
        expectEq("one match: selected in its cell", cell()?.slice(0, 2), [1, 0]);
        expectEq("the match", dom(`const c=app.workspace.activeLeaf.view.editor.editorComponent.tableCell.editor.cm;const m=c.state.selection.main;return [m.from,c.state.sliceDoc(m.from,m.to)]`), [2, "needle"]);
        tableKeys("<esc>");
        setDoc("#[a|]#bove\n\n| h1 | h2 |\n| -- | -- |\n| aa | b |\n\nbelow\n");
        Bun.sleepSync(500);
        tableKeys("%");
        expectEq("% alone keeps the row marks and paints no cells", painted(), [0, 0, 0]);
        tableKeys("<esc>");
      },
    },
    {
      name: "table: j and k keep the column, and leave the table at its edges",
      run: () => {
        inTable();
        tableKeys("l");
        tableKeys("l");
        tableKeys("j");
        expectEq("row 1", cell()?.slice(0, 2), [1, 1]);
        tableKeys("j");
        expectEq("row 2", cell()?.slice(0, 2), [2, 1]);
        tableKeys("j");
        expectEq("out", cell(), null);
        tableKeys("k");
        tableKeys("3k");
        expectEq("out above", cell(), null);
      },
    },
    {
      name: "table: typing in a cell edits the note, and u undoes it as one history",
      run: () => {
        inTable();
        tableKeys("iZ");
        tableKeys("<esc>");
        expectEq("note changed", note().includes("Zh1"), true);
        tableKeys("u");
        expectEq("undone", note().includes("Zh1"), false);
        tableKeys("U");
        expectEq("redone", note().includes("Zh1"), true);
      },
    },
    {
      name: "table: x selects the row, x extends it, d removes it",
      run: () => {
        inTable();
        tableKeys("j");
        tableKeys("x");
        expectEq("one row", cellsSelected(), 3);
        tableKeys("x");
        expectEq("two rows", cellsSelected(), 6);
        tableKeys("<esc>");
        expectEq("back to one cell", cellsSelected(), 0);
        tableKeys("x");
        tableKeys("d");
        expectEq("row gone", note().includes("| a"), true);
        expectEq("row gone", note().includes("| d"), false);
      },
    },
    {
      name: "table: select mode extends past the cell into cells, y and p copy them as table text",
      run: () => {
        inTable();
        tableKeys("j");
        tableKeys("v");
        tableKeys("l");
        tableKeys("l");
        expectEq("cells selected", cellsSelected(), 2);
        tableKeys("y");
        const text = String(evalJs(`navigator.clipboard.readText().then(t=>JSON.stringify(t))`));
        expectEq("table text", text.includes("|"), true);
        tableKeys("<esc><esc>");
      },
    },
    {
      name: "table: o adds a row and enters insert mode, J does nothing",
      run: () => {
        inTable();
        const rows = () => note().split("\n").filter((l) => l.startsWith("|")).length;
        const before = rows();
        tableKeys("J");
        expectEq("J", rows(), before);
        tableKeys("o");
        expectEq("a row more", rows(), before + 1);
        tableKeys("<esc>");
      },
    },
    {
      name: "table: Alt-o is not bound, and an Obsidian command bound in helix.toml adds a column",
      run: () => {
        inTable();
        const columns = () => note().split("\n").find((l) => l.startsWith("|"))!.split("|").length;
        const before = columns();
        tableKeys("<A-o>");
        expectEq("Alt-o does nothing", columns(), before);
        evalJs(`JSON.stringify(app.commands.executeCommandById("editor:table-col-after"))`);
        Bun.sleepSync(250);
        expectEq("a column more", columns(), before + 1);
      },
    },
    {
      name: "table: mi| selects the cell text, ma| selects the cell, mip selects the table",
      run: () => {
        inTable();
        tableKeys("mi|");
        expectEq("no cell selection", cellsSelected(), 0);
        tableKeys("d");
        expectEq("text gone", note().includes("h1"), false);
        tableKeys("u");
        tableKeys("ma|");
        expectEq("one cell", cellsSelected(), 1);
        tableKeys(";");
        expectEq("back to text", cellsSelected(), 0);
        tableKeys("mip");
        expectEq("whole table", cellsSelected(), 9);
        tableKeys("d");
        expectEq("table gone", note().includes("|"), false);
        tableKeys("u");
      },
    },
    {
      name: "table: select mode past the text selects this cell, then neighbours, and motions work on cells",
      run: () => {
        inTable();
        tableKeys("v");
        tableKeys("gl");
        expectEq("still text", cellsSelected(), 0);
        tableKeys("l");
        expectEq("this cell", cellsSelected(), 1);
        tableKeys("l");
        expectEq("two cells", cellsSelected(), 2);
        tableKeys("j");
        expectEq("a block", cellsSelected(), 4);
        tableKeys("<esc>");
        expectEq("normal mode keeps the cells", cellsSelected(), 4);
        tableKeys("l");
        expectEq("a normal motion moves one cell", cellsSelected(), 1);
        tableKeys("<esc>");
        expectEq("esc goes back to text", cellsSelected(), 0);
      },
    },
    {
      name: "table: x selects rows, x again adds a row, and e and b walk through cells",
      run: () => {
        inTable();
        tableKeys("x");
        expectEq("one row", cellsSelected(), 3);
        tableKeys("x");
        expectEq("two rows", cellsSelected(), 6);
        tableKeys("<esc>");
        tableKeys("e");
        tableKeys("e");
        expectEq("next cell", cell()?.[1], 1);
        tableKeys("b");
        expectEq("previous cell", cell()?.[1], 0);
      },
    },
    {
      name: "table: the caret shows in insert mode in a cell, also with several cursors, and hides in normal mode",
      run: () => {
        const caret = (expr: string) => evalJs<string>(`JSON.stringify(getComputedStyle(app.workspace.activeLeaf.view.editor.${expr}.contentDOM).caretColor)`);
        const cellCaret = () => caret("editorComponent.tableCell.editor.cm");
        const hidden = "rgba(0, 0, 0, 0)";
        inTable();
        expectEq("normal mode in a cell", cellCaret(), hidden);
        tableKeys("i");
        expectTrue("insert mode in a cell", cellCaret() !== hidden);
        expectEq("the note stays hidden", caret("cm"), hidden);
        tableKeys("<esc>");
        tableKeys("C");
        tableKeys("i");
        expectTrue("insert mode with several cursors", cellCaret() !== hidden);
        tableKeys("<esc>");
        tableKeys(",");
      },
    },
    {
      name: "table: a cursor in another cell sits and looks like the main one, in every state",
      run: () => {
        const place = (text: string) => {
          setDoc(`#[a|]#bove\n\n| h | x |\n| -- | -- |\n| ${text} | 1 |\n| ${text} | 2 |\n\nbelow\n`);
          Bun.sleepSync(500);
          tableKeys("jjj");
          tableKeys("C");
        };
        const boxes = () => evalJs<{ main: number[] | null; caret: number[]; other: number[]; others: number; sel: number[][] }>(`JSON.stringify((()=>{const c=app.workspace.activeLeaf.view.editor.editorComponent.tableCell;const t=c.table;const inCell=(r,base)=>[r.left-base.left,r.top-base.top,r.width,r.height].map(n=>Math.round(n*2)/2);const mine=c.cell.el.getBoundingClientRect();const next=t.rows[c.cell.row+1][c.cell.col].el.getBoundingClientRect();const v=c.editor.cm;const main=v.dom.querySelector(".hx-cursors .hx-cell");const other=[...document.querySelectorAll(".hx-cell-cursors .hx-cell")];const co=v.coordsAtPos(v.state.selection.main.head,1);return {main:main?inCell(main.getBoundingClientRect(),mine):null,caret:inCell(co,mine),other:other[0]?inCell(other[0].getBoundingClientRect(),next):[],others:other.length,sel:[...document.querySelectorAll(".hx-cell-selections .hx-cell")].map(e=>inCell(e.getBoundingClientRect(),next))}})())`);
        const same = (what: string) => {
          Bun.sleepSync(150);
          const b = boxes();
          expectEq(`${what}: one cursor in the other cell`, b.others, 1);
          expectEq(`${what}: same place as the main cursor`, b.other, b.main);
        };
        place("asdf");
        same("normal, first character");
        tableKeys("l");
        same("normal, second character");
        tableKeys("gl");
        same("normal, last character");
        tableKeys("gh");
        place("two words");
        tableKeys("e");
        same("after e");
        expectEq("after e: the selection shows without the cursor's character", boxes().sel.length, 1);
        place("");
        same("normal, empty cell");
        place("a **bold** end");
        tableKeys("lll");
        Bun.sleepSync(150);
        expectEq("on hidden markup: the next letter shows on the block", evalJs(`JSON.stringify(document.querySelector(".hx-cell-cursors .hx-cell-glyph")?.textContent ?? "")`), "b");
        place("asdf");
        tableKeys("l");
        tableKeys("i");
        const before = boxes();
        expectEq("insert: the cursor's character is not selected", before.sel, []);
        expectEq("insert: the block starts at the caret", before.other[0], before.caret[0]);
        tableKeys("<esc>");
        tableKeys("a");
        const after = boxes();
        expectEq("append: the block starts at the caret", after.other[0], after.caret[0]);
        expectEq("append: only the character before the cursor is selected", after.sel.length, 1);
        expectEq("append: selection ends at the caret", (after.sel[0]?.[0] ?? 0) + (after.sel[0]?.[2] ?? 0), after.caret[0]);
        tableKeys("<esc>");
        tableKeys("A");
        const end = boxes();
        expectEq("A: the block sits after the last character", end.other[0], end.caret[0]);
        tableKeys("<esc>");
        tableKeys(",");
        place("");
        tableKeys("i");
        const empty = boxes();
        expectEq("insert in an empty cell", empty.other[0], empty.caret[0]);
        tableKeys("x");
        Bun.sleepSync(150);
        const typed = boxes();
        expectEq("typing moves both", typed.other[0], typed.caret[0]);
        tableKeys("<esc>");
        tableKeys(",");
      },
    },
    {
      name: "table: no cursor stays drawn after leaving the cells",
      run: () => {
        const left = () => evalJs<number>(`JSON.stringify(document.querySelectorAll(".hx-cell-cursors, .hx-cell-selections").length)`);
        const start = () => {
          inTable();
          tableKeys("C");
          expectEq("drawn", left(), 2);
        };
        for (const exit of ["ge", "gg", "%", ",", "<esc>,", ":<esc>", "/<esc>"]) {
          start();
          tableKeys(exit);
          expectEq(`after ${exit}`, left(), 0);
          tableKeys("<esc>");
        }
        start();
        tableKeys("i");
        const [x, y] = evalJs<[number, number]>(`JSON.stringify((()=>{const ed=app.workspace.activeLeaf.view.editor.cm;const r=ed.coordsAtPos(ed.state.doc.length-3);return [r.left+1,r.top+3]})())`);
        mouse("mousePressed", x, y);
        mouse("mouseReleased", x, y);
        Bun.sleepSync(300);
        expectEq("after a click below the table", left(), 0);
        tableKeys("<esc>");
        start();
        evalJs(`JSON.stringify((app.workspace.activeLeaf.view.editor.cm.focus(), true))`);
        Bun.sleepSync(300);
        expectEq("after the focus moves to the note", left(), 0);
        tableKeys("<esc>");
      },
    },
    {
      name: "table: after % and s, cursors in cells keep to the cells",
      run: () => {
        const cursors = () => evalJs<string[]>(`JSON.stringify((()=>{const v=app.workspace.activeLeaf.view.editor.cm;const d=v.state.doc;return v.state.selection.ranges.map(r=>{const c=r.head>r.anchor?r.head-1:r.head;return d.sliceString(c,c+1)})})())`);
        const drawn = () => evalJs<number>(`JSON.stringify(document.querySelectorAll(".hx-cell-cursors .hx-cell").length)`);
        const start = (doc: string) => {
          setDoc(doc);
          Bun.sleepSync(500);
          tableKeys("%");
          tableKeys("sneedle");
          tableKeys("<ret>");
        };
        const mixed = "#[a|]#bove\n\n| h1 | h2 |\n| -- | -- |\n| x needle y | b |\n| c | needle |\n\nbelow needle end\n";
        start(mixed);
        expectEq("three matches", cursors(), ["e", "e", "e"]);
        tableKeys("l");
        expectEq("l: one goes to the space, one crosses nothing at the row's end, one stays in the text", drawn(), 2);
        expectTrue("no cursor on a pipe", !cursors().includes("|"));
        tableKeys("gl");
        expectTrue("gl stays in the cells", !cursors().includes("|"));
        expectEq("gl keeps all three", cursors().length, 3);
        tableKeys("9e");
        expectTrue("e never lands on a pipe", !cursors().includes("|"));
        tableKeys("<esc>");
        tableKeys(",");
        tableKeys("<esc>");
        start("#[a|]#bove\n\n| h1 | h2 |\n| -- | -- |\n| needle a | needle b |\n\nbelow\n");
        tableKeys("gl");
        expectEq("two in one row stay two", cursors(), ["a", "b"]);
        tableKeys("<esc>");
        tableKeys(",");
        tableKeys("<esc>");
        start("#[a|]#bove\n\n| h1 | h2 |\n| -- | -- |\n| needle a | b |\n| c | needle d |\n\nbelow\n");
        tableKeys("gh");
        tableKeys("fb");
        expectEq("f does not reach into the next cell", cursors(), ["n", "n"]);
        tableKeys("fa");
        expectEq("f finds in its own cell", cursors(), ["a", "n"]);
        tableKeys("9j");
        expectEq("j stops at the last row", cursors().length, 2);
        const lines = note().split("\n").length;
        tableKeys("o");
        expectEq("o is refused", note().split("\n").length, lines);
        tableKeys("A");
        tableKeys("Z");
        tableKeys("<esc>");
        expectTrue("A adds at the end of each cell", note().includes("needle aZ") && note().includes("needle dZ"));
        tableKeys(",");
        tableKeys("<esc>");
      },
    },
    {
      name: "table: a cursor in a cell acts the same alone, with C and after % and s",
      run: () => {
        const text = 'foo (bar "baz" qux) end-of word';
        const doc = `#[a|]#bove\n\n| h1 | h2 |\n| -- | -- |\n| ${text} | 1 |\n| ${text} | 2 |\n\nbelow\n`;
        const steps = ["e", "e", "b", "l", "h", "2e", "3l", "gl", "gh", "gs", "f(", "t)", "T(", "F(", "mi(", 'mi"', 'ma"', "miw", "maw", "mm", "mi|", ";", "<A-;>", "gh", "v", "e", "b", "gl", "gh", "fq", "<esc>", "gh", "w", "W", "E", "B", "<A-e>", "<A-b>", "gh", "e", "<A-o>", "<A-o>", "<A-i>", "<A-n>", "<A-p>", "<esc>", "gh", "5l", "e", "d", "gl", "d", "b", "~", "gh", "rZ", "ge"];
        const read = (mode: string) => evalJs<unknown>(`JSON.stringify((()=>{const ed=app.workspace.activeLeaf.view.editor;const c=ed.editorComponent.tableCell;if("${mode}"!=="note"){return [c.editor.cm.state.doc.toString(),c.editor.cm.state.selection.ranges.map(r=>[r.anchor,r.head])]}const t=document.querySelector(".cm-table-widget").cmTile.widget;const {start,end,textStart,textEnd}=t.rows[1][0].getAbsoluteOffsets();return [ed.cm.state.sliceDoc(textStart,textEnd),ed.cm.state.selection.ranges.filter(r=>r.from>=start&&r.from<end).map(r=>[Math.min(r.anchor,textEnd)-textStart,Math.min(r.head,textEnd)-textStart])]})())`);
        const run = (mode: string): string[] => {
          setDoc(doc);
          Bun.sleepSync(500);
          if (mode === "note") {
            tableKeys("%");
          } else {
            tableKeys("jjj");
            if (mode === "cursors") tableKeys("C");
            tableKeys("mi|");
          }
          tableKeys("sfoo");
          tableKeys("<ret>");
          const out: string[] = [];
          for (const step of steps.filter((k) => k !== "ge")) {
            tableKeys(step);
            out.push(`${step}=${JSON.stringify(read(mode))}`);
          }
          tableKeys("<esc>");
          tableKeys(",");
          tableKeys("<esc>");
          return out;
        };
        const alone = run("alone");
        for (const mode of ["cursors", "note"]) {
          const got = run(mode);
          const wrong = got.filter((g, i) => g !== alone[i]).map((g) => `${g} (alone ${alone[got.indexOf(g)]})`);
          expectEq(`${mode} differs`, wrong, []);
        }
      },
    },
    {
      name: "table: edits after % and s cannot break a row",
      run: () => {
        const doc = "#[a|]#bove\n\n| h1 | h2 |\n| -- | -- |\n| needle | b |\n| c | needle |\n\nbelow needle\n";
        const start = () => {
          setDoc(doc);
          Bun.sleepSync(500);
          tableKeys("%");
          tableKeys("sneedle");
          tableKeys("<ret>");
        };
        const finish = () => {
          tableKeys("<esc>");
          tableKeys(",");
          tableKeys("<esc>");
        };
        start();
        tableKeys("cA|B");
        tableKeys("<esc>");
        expectEq("a typed pipe is escaped in cells only", note(), "above\n\n| h1 | h2 |\n| -- | -- |\n| A\\|B | b |\n| c | A\\|B |\n\nbelow A|B\n");
        finish();
        setDoc(doc);
        Bun.sleepSync(500);
        tableKeys("%");
        tableKeys("y");
        tableKeys("sneedle");
        tableKeys("<ret>");
        tableKeys("R");
        expectEq("several lines into a cell is refused", note(), doc.replace("#[a|]#", "a"));
        finish();
        start();
        tableKeys("<gt>");
        expectEq("indent is refused", note(), doc.replace("#[a|]#", "a"));
        finish();
        setDoc(doc);
        Bun.sleepSync(500);
        tableKeys("%");
        tableKeys("s(dle \\| b|needle$)");
        tableKeys("<ret>");
        tableKeys("d");
        expectEq("deleting across a cell's edge is refused", note().includes("| -- |\n| nee"), true);
        finish();
        start();
        const marked = () => evalJs<number>(`JSON.stringify(document.querySelectorAll(".hx-row-selected").length)`);
        tableKeys("x");
        expectEq("x marks both rows", marked(), 4);
        expectEq("x: rows are not shaded twice", evalJs(`JSON.stringify(document.querySelectorAll(".hx-cell-selections .hx-cell").length)`), 0);
        expectEq("x: each row shows its cursor at the row's end", evalJs(`JSON.stringify(document.querySelectorAll(".hx-cell-cursors .hx-cell").length)`), 2);
        expectEq("x: nothing is drawn for the hidden rows", evalJs(`JSON.stringify([...app.workspace.activeLeaf.view.editor.cm.dom.querySelectorAll(":scope > .cm-scroller > .hx-cursors > .hx-cell")].length)`), 1);
        tableKeys("d");
        expectEq("x then d removes the rows", note().includes("| c |"), false);
        finish();
        start();
        tableKeys("C");
        expectTrue("C adds in the same column", !note().includes("#"));
        expectEq("C: one more in the table", evalJs(`JSON.stringify(app.workspace.activeLeaf.view.editor.cm.state.selection.ranges.length)`), 4);
        finish();
        const long = "word ".repeat(120).trim();
        setDoc(`#[a|]#bove\n\n| h1 | h2 |\n| -- | -- |\n| needle | b |\n\nneedle ${long}\nnext\n`);
        Bun.sleepSync(500);
        tableKeys("%");
        tableKeys("sneedle");
        tableKeys("<ret>");
        const line = () => evalJs<number>(`JSON.stringify((()=>{const v=app.workspace.activeLeaf.view.editor.cm;const r=v.state.selection.ranges[v.state.selection.ranges.length-1];return v.state.doc.lineAt(r.head).number})())`);
        const before = line();
        tableKeys("j");
        expectEq("j moves one visual row outside the table", line(), before);
        finish();
      },
    },
    {
      name: "table: an input method types in every cursor, with C and after % and s",
      run: () => {
        const compose = (text: string) => {
          sendDomKey(domKey("a", { key: "Process", code: "KeyA", keyCode: 229 } as never));
          Bun.sleepSync(80);
          ob("dev:cdp", "method=Input.imeSetComposition", `params=${JSON.stringify({ text: "k", selectionStart: 1, selectionEnd: 1 })}`);
          ob("dev:cdp", "method=Input.insertText", `params=${JSON.stringify({ text })}`);
          Bun.sleepSync(200);
        };
        inTable();
        tableKeys("C");
        tableKeys("i");
        compose("か");
        tableKeys("<esc>");
        expectEq("C: both cells", [note().includes("かh1"), note().includes("かa")], [true, true]);
        tableKeys(",");
        tableKeys("<esc>");
        setDoc("#[a|]#bove\n\n| h1 | h2 |\n| -- | -- |\n| needle | b |\n| c | needle |\n\nbelow\n");
        Bun.sleepSync(500);
        tableKeys("%");
        tableKeys("sneedle");
        tableKeys("<ret>");
        tableKeys("c");
        compose("か");
        tableKeys("<esc>");
        expectEq("% s: both matches", note().split("か").length, 3);
        expectEq("nothing typed outside", note().includes("か\nbelow"), false);
        tableKeys(",");
        tableKeys("<esc>");
      },
    },
    {
      name: "table: clicking a search result outside the table leaves the cell",
      run: () => {
        const md = `app.workspace.getLeavesOfType("markdown").find(l=>l.view.file?.path==="scratch.md")`;
        setDoc("#[a|]#bove\n\n| h1 | h2 |\n| -- | -- |\n| x needle y | b |\n\nbelow needle\n");
        Bun.sleepSync(400);
        evalJs(`JSON.stringify((${md}.view.save(),true))`);
        Bun.sleepSync(900);
        evalJs(`JSON.stringify((app.internalPlugins.getPluginById("global-search").instance.openGlobalSearch("needle"),true))`);
        Bun.sleepSync(2200);
        const click = (i: number) => {
          const [x, y] = evalJs<[number, number]>(`JSON.stringify((()=>{const b=[...document.querySelectorAll(".search-result-file-match")][${i}].getBoundingClientRect();return [b.left+b.width/2,b.top+b.height/2]})())`);
          mouse("mousePressed", x, y);
          Bun.sleepSync(60);
          mouse("mouseReleased", x, y);
          Bun.sleepSync(900);
        };
        const where = () => evalJs<[boolean, string]>(`JSON.stringify((()=>{const ed=${md}.view.editor;const m=ed.cm.state.selection.main;return [ed.activeCM!==ed.cm,ed.cm.state.sliceDoc(m.from,m.from+6)]})())`);
        click(0);
        expectEq("in the cell, on the match", where(), [true, "needle"]);
        Bun.sleepSync(2500);
        click(1);
        expectEq("out of the cell, on the match", where(), [false, "needle"]);
        Bun.sleepSync(2500);
        click(0);
        expectEq("back in the cell", where(), [true, "needle"]);
        evalJs(`JSON.stringify((app.workspace.setActiveLeaf(${md},{focus:true}),true))`);
        Bun.sleepSync(400);
        tableKeys("<esc>");
      },
    },
    {
      name: "table: C adds a cursor in the row below, typing edits both cells",
      run: () => {
        inTable();
        tableKeys("C");
        expectEq("drawn in the other cell", evalJs(`JSON.stringify(document.querySelectorAll(".hx-cell-cursors .hx-cell").length)`), 1);
        tableKeys("iZ");
        tableKeys("<esc>");
        expectEq("first cell", note().includes("Zh1"), true);
        expectEq("second cell", note().includes("Za"), true);
        tableKeys(",");
        expectEq("back to one cursor", evalJs(`JSON.stringify(document.querySelectorAll(".hx-cell-cursors .hx-cell").length)`), 0);
        tableKeys("<esc>");
      },
    },
    {
      name: "table: C then j moves both cursors, and mi| selects text in each",
      run: () => {
        inTable();
        tableKeys("C");
        tableKeys("mi|");
        tableKeys("d");
        expectEq("both emptied", [note().includes("h1"), note().includes("| a ")], [false, false]);
        tableKeys("u");
        tableKeys(",");
      },
    },
    {
      name: "table: a block of cells, i types in all of them",
      run: () => {
        inTable();
        tableKeys("v");
        tableKeys("gll");
        tableKeys("j");
        tableKeys("<esc>");
        expectEq("two cells", cellsSelected(), 2);
        tableKeys("c");
        Bun.sleepSync(250);
        tableKeys("Q");
        tableKeys("<esc>");
        expectEq("both changed", note().split("\n").filter((l) => l.startsWith("| Q")).length, 2);
        tableKeys(",");
      },
    },
    {
      name: "table: select mode from above runs over rows, and a selection from outside marks them",
      run: () => {
        setDoc(TABLE);
        Bun.sleepSync(500);
        tableKeys("v");
        tableKeys("j");
        tableKeys("j");
        expectEq("not in a cell", cell(), null);
        expectEq("marked", (evalJs(`JSON.stringify(document.querySelectorAll(".hx-row-selected").length)`) as number) >= 3, true);
        tableKeys("<esc>;");
      },
    },
    {
      name: "helix.toml binds an Obsidian command by its id",
      run: () => {
        setDoc("#[a|]#bc\n");
        Bun.sleepSync(300);
        const helix = `app.plugins.plugins["helix-motions"]`;
        evalJs(`JSON.stringify((()=>{const p=${helix};const h=p.helix;h.keymaps=p.keymapsFor({normal:{name:"",map:{"X":"editor:toggle-bold"}}});return 1})())`);
        tableKeys("X");
        Bun.sleepSync(250);
        expectEq("ran", note().includes("**"), true);
        evalJs(`JSON.stringify((()=>{const p=${helix};p.reloadConfig();return 1})())`);
        Bun.sleepSync(250);
      },
    },
    {
      name: "table: messages, prompts and key help show in the note's panel, not in the cell",
      run: () => {
        inTable();
        tableKeys(":echo hello<ret>");
        const shown = () => evalJs<{ cell: number; main: string | null }>(`JSON.stringify((()=>{const v=app.workspace.activeLeaf.view.editor.cm;const widget=v.contentDOM.querySelector(".cm-table-widget");return {cell:widget.querySelectorAll(".hx-panel > :not(.hx-hidden)").length,main:[...v.dom.querySelectorAll(":scope > .cm-panels .hx-panel > :not(.hx-hidden)")].map(e=>e.textContent).join("|")}})())`);
        expectEq("message", shown(), { cell: 0, main: "hello" });
        expectEq("still in the cell", cell()?.slice(0, 2), [0, 0]);
        tableKeys(":");
        expectEq("prompt", shown().cell, 0);
        expectEq("prompt in the note", shown().main?.includes(":"), true);
        tableKeys("<esc>");
        tableKeys("g");
        expectEq("key help", shown().cell, 0);
        expectEq("key help in the note", (shown().main ?? "").length > 0, true);
        tableKeys("<esc>");
      },
    },
    {
      name: "table: gg and % from a cell act on the note",
      run: () => {
        inTable();
        tableKeys("j");
        tableKeys("gg");
        expectEq("left the table", cell(), null);
        expectEq("first line", cursorLine(), 1);
        tableKeys("jj");
        tableKeys("%");
        const s = state();
        expectEq("whole note", s.ranges[0]?.[1], (s as unknown as { text: string }).text.length);
        tableKeys(";");
      },
    },
    {
      name: "table: a macro replays across cells",
      run: () => {
        inTable();
        tableKeys("QiX<esc>glllQ".replace("gl", ""));
        expectEq("recorded", note().includes("Xh1"), true);
        tableKeys("q");
        expectEq("replayed in the next cell", note().includes("Xh2"), true);
      },
    },
  ];
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
      ob("eval", 'code=app.workspace.activeLeaf.view.setState({mode:"source",source:false},{history:false})');
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
    name: "Example config: jk leaves insert mode",
    run: () => {
      setDoc("#[x|]#\n");
      keys("iajk");
      const s = state() as AppState & { text: string };
      expectEq("mode", s.mode, "normal");
      expectEq("text", s.text, "ax\n");
    },
  },
  {
    name: "Example config: j then other key inserts both",
    run: () => {
      setDoc("#[x|]#\n");
      keys("ijo<esc>");
      expectEq("text", (state() as unknown as { text: string }).text, "jox\n");
    },
  },
  {
    name: "Example config: w runs the @miw macro",
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
    name: "the toggle command turns Helix off and back on",
    run: () => {
      setDoc("#[x|]#\n");
      const toggle = () => evalJs("JSON.stringify(app.commands.executeCommandById('helix-motions:toggle'))");
      const status = () => evalJs<string>("JSON.stringify(document.querySelector('.hx-status')?.innerText ?? '')");
      toggle();
      try {
        expectEq("status hidden", status(), "");
        keys("i");
        expectTrue("i is typed as text", (dom("return v.state.doc.toString()") as string).includes("i"));
      } finally {
        toggle();
      }
      expectTrue("status back", status().includes("NOR"), status());
      expectEq("back in normal mode", state().mode, "normal");
    },
  },
  {
    name: "line numbers in config switch Obsidian's own line numbers",
    run: () => {
      const shown = () => evalJs<boolean>(`JSON.stringify(app.vault.getConfig("showLineNumber"))`);
      const before = shown();
      try {
        api(`a.useConfig(${JSON.stringify('[editor]\ngutters = ["diagnostics"]\n')})`);
        expectEq("gutters without line-numbers", shown(), false);
        api(`a.useConfig(${JSON.stringify('[editor]\nline-number = "relative"\n')})`);
        expectEq("line-number turns them on", shown(), true);
        api(`a.useConfig(${JSON.stringify('[editor]\nscrolloff = 3\n')})`);
        expectEq("no key leaves the setting alone", shown(), true);
        expectEq("no relative gutter", dom("return v.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement').length > 0 && [...v.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].some(e => e.innerText === '0')"), false);
      } finally {
        evalJs(`JSON.stringify((app.vault.setConfig("showLineNumber", ${JSON.stringify(before)}), "ok"))`);
        api("a.useConfig(null)");
      }
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
    name: "gd and C-w f on a heading link open the note at the heading; [[#heading]] jumps in the same note",
    run: () => {
      const where = () => evalJs<string>("JSON.stringify((()=>{const e=app.workspace.activeEditor; return e?.file && e.editor ? e.file.path + ':' + (e.editor.getCursor().line + 1) : ''})())");
      const wait = (want: string) => {
        for (let i = 0; i < 20 && where() !== want; i++) Bun.sleepSync(100);
        return where();
      };
      setDoc("see [[Demonstration#Sun#[d|]#ay|the day]] here\n");
      keys("gd");
      expectEq("gd", wait("Demonstration.md:14"), "Demonstration.md:14");
      keys("<C-o>");
      expectEq("back", wait("scratch.md:1"), "scratch.md:1");
      setDoc("see [[Demonstration#Sun#[d|]#ay]] here\n");
      keys("<C-w>f");
      expectEq("split", wait("Demonstration.md:14"), "Demonstration.md:14");
      evalJs("JSON.stringify((app.workspace.getLeavesOfType('markdown').filter(l=>l.view.file?.path==='Demonstration.md').forEach(l=>l.detach()), true))");
      evalJs("JSON.stringify((app.workspace.setActiveLeaf(app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path==='scratch.md'),{focus:true}), true))");
      setDoc("# Top\ntext\n## Far\nsee [[#F#[a|]#r]]\n");
      keys("gd");
      expectEq("same note", wait("scratch.md:3"), "scratch.md:3");
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
    name: "j moves by visual row on a wrapped line, gj by logical line",
    run: () => {
      const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
      setDoc(`#[w|]#${long.slice(1)}\nnext line\n`);
      keys("j");
      const afterJ = api<{ text: string; ranges: [number, number][] }>("a.state()");
      expectTrue("still on first logical line", afterJ.ranges[0]![0] > 0 && afterJ.ranges[0]![0] < long.length, JSON.stringify(afterJ.ranges));
      setDoc(`#[w|]#${long.slice(1)}\nnext line\n`);
      keys("gj");
      const afterGj = api<{ ranges: [number, number][] }>("a.state()");
      expectEq("gj lands on next line", afterGj.ranges[0]![0], long.length + 1);
    },
  },
  {
    name: "C-d and C-u scroll half a page and move the cursor",
    run: () => {
      setDoc("#[l|]#" + Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n").slice(1) + "\n");
      keys("<C-d>");
      const down = api<{ ranges: [number, number][] }>("a.state()").ranges[0]![0];
      const top = dom("return v.scrollDOM.scrollTop") as number;
      expectTrue("cursor moved down", down > 50, String(down));
      expectTrue("view scrolled", top > 0, String(top));
      keys("<C-u>");
      const up = api<{ ranges: [number, number][] }>("a.state()").ranges[0]![0];
      expectTrue("cursor moved back up", up < down, `${up} < ${down}`);
    },
  },
  {
    name: "zz centers and gt/gb go to window top and bottom",
    run: () => {
      setDoc("#[l|]#" + Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n").slice(1) + "\n");
      keys("150Gzz");
      Bun.sleepSync(200);
      const line = (pos: number) => dom(`return v.state.doc.lineAt(${pos}).number`) as number;
      keys("gt");
      const topLine = line(api<{ text: string; ranges: [number, number][] }>("a.state()").ranges[0]![0]);
      keys("gb");
      const bottomLine = line(api<{ text: string; ranges: [number, number][] }>("a.state()").ranges[0]![0]);
      expectTrue("top above 150 and bottom below", topLine < 150 && bottomLine > 150, `${topLine} ${bottomLine}`);
    },
  },
  {
    name: "syntax tree: Alt-o, Alt-i, mm and markdown auto-pairs follow Helix",
    run: () => {
      setDoc("a **b#[o|]#ld** c\n");
      keys("<A-o>");
      expectEq("expand to strong", state().markup, "a #[**bold**|]# c\n");
      keys("<A-o>");
      expectEq("expand to inline", state().markup, "#[a **bold** c|]#\n");
      keys("<A-i>");
      expectEq("shrink back", state().markup, "a #[**bold**|]# c\n");
      setDoc("a (b #[c|]# d) e\n");
      keys("mm");
      expectEq("mm finds the enclosing pair", state().markup, "a (b c d#[)|]# e\n");
      evalJs(`app.plugins.plugins["helix-motions"].helix.helixAutoPairs = true`);
      setDoc("text\n#[\n|]#");
      keys("i“<esc>");
      evalJs(`(p => p.helix.helixAutoPairs = p.settings.autoPairs === "helix")(app.plugins.plugins["helix-motions"])`);
      expectEq("markdown layer pairs smart quotes", state().markup, "text\n“#[|”]#\n");
    },
  },
  {
    name: "shell commands say there is no shell instead of crashing",
    run: () => {
      setDoc("#[x|]#\n");
      keys("|ls<ret>");
      const s = state();
      expectTrue("status set", !!s.status && /No shell set/.test(s.status.message), JSON.stringify(s.status));
    },
  },
  {
    name: "unresolved links act as diagnostics; space a opens the command palette",
    run: () => {
      setDoc("#[s|]#ee [[Welcome]] and [[nowhere]] then ![[ghost.png]] end\n");
      for (let i = 0; i < 30; i++) {
        Bun.sleepSync(200);
        if (evalJs<number>(`JSON.stringify(Object.keys(app.metadataCache.unresolvedLinks["scratch.md"] ?? {}).length)`) >= 2) break;
      }
      keys("]d");
      expectEq("next", state().markup, "see [[Welcome]] and #[[[nowhere]]|]# then ![[ghost.png]] end\n");
      keys("]D");
      expectEq("last", state().markup, "see [[Welcome]] and [[nowhere]] then #[![[ghost.png]]|]# end\n");
      keys("[d");
      expectEq("prev", state().markup, "see [[Welcome]] and #[[[nowhere]]|]# then ![[ghost.png]] end\n");
      keys("<space>d");
      Bun.sleepSync(200);
      expectEq("picker", evalJs(`JSON.stringify([...document.querySelectorAll(".suggestion-item")].map(e=>e.innerText))`), ["1: nowhere", "1: ghost.png"]);
      keys("<esc><space>a");
      Bun.sleepSync(200);
      expectEq("palette", evalJs(`JSON.stringify(document.querySelector(".prompt-input")?.placeholder ?? null)`), "Select a command...");
      keys("<esc>");
    },
  },
  {
    name: "settings: helix.toml editor runs Helix keys and :w saves the file",
    run: () => {
      evalJs(`JSON.stringify((app.setting.open(), app.setting.openTabById("helix-motions"), 1))`);
      Bun.sleepSync(500);
      try {
        const result = evalJs<{ text: string; ranges: number; status: string | null; warnings: number }>(
          `JSON.stringify((()=>{const p=app.plugins.plugins["helix-motions"]; const v=p.configView; const host=p.hostForView(v); p.helix.feedKeys(host, "ggx"); const sel=v.state.selection.main; const text=v.state.sliceDoc(sel.from, sel.to); p.helix.feedKeys(host, "C"); const ranges=v.state.selection.ranges.length; p.helix.feedKeys(host, ",<esc>:w<ret>"); return {text, ranges, status: null, warnings: p.configWarnings.length}})())`,
        );
        expectEq("x selects the first line", result.text, "[editor]");
        expectEq("C adds a selection", result.ranges, 2);
        Bun.sleepSync(300);
        expectEq("saved", evalJs(`JSON.stringify(app.plugins.plugins["helix-motions"].helix.status?.message ?? null)`), "helix.toml saved");
      } finally {
        evalJs(`JSON.stringify((app.setting.close(), 1))`);
        openScratch();
      }
    },
  },
  {
    name: "unbound Ctrl with Home, End or Page goes to Obsidian and macOS in normal mode, Ctrl-k does not edit",
    run: () => {
      setDoc("#[h|]#ello world\n");
      evalJs(`JSON.stringify((window.hxLastKey=null, window.hxKeyProbe||(window.hxKeyProbe=(e)=>{window.hxLastKey={key:e.key,prevented:e.defaultPrevented}}, window.addEventListener("keydown", window.hxKeyProbe)), 1))`);
      for (const k of ["C-home", "C-S-pagedown", "C-end"]) {
        sendDomKey(domKey(k));
        const got = evalJs<{ prevented: boolean } | null>(`JSON.stringify(window.hxLastKey)`);
        expectEq(`${k} not prevented`, got?.prevented, false);
      }
      expectEq("selection unchanged", state().markup, "#[h|]#ello world\n");
      sendDomKey(domKey("C-k"));
      expectEq("Ctrl-k changes nothing", state().markup, "#[h|]#ello world\n");
      evalJs(`JSON.stringify((window.removeEventListener("keydown", window.hxKeyProbe), window.hxKeyProbe=null, 1))`);
    },
  },
  {
    name: "Option dead keys run their Alt binding in normal mode",
    run: () => {
      setDoc("- a\n- #[b|]#\n- c\n");
      sendDomKey({ key: "Dead", code: "KeyN", keyCode: 78, modifiers: 1 });
      expectEq("A-n selects the next list item", state().markup, "- a\n- b\n#[- c\n|]#");
    },
  },
  {
    name: "IME composition outside insert mode changes nothing and never sticks",
    run: () => {
      setDoc("#[h|]#ello world\n");
      ob("dev:cdp", "method=Input.imeSetComposition", `params=${JSON.stringify({ text: "˜", selectionStart: 1, selectionEnd: 1 })}`);
      ob("dev:cdp", "method=Input.insertText", `params=${JSON.stringify({ text: "ñ" })}`);
      Bun.sleepSync(100);
      expectEq("markup", state().markup, "#[h|]#ello world\n");
      expectEq("not composing", dom("return v.compositionStarted"), false);
      keys("e");
      expectEq("keys still work", state().markup, "#[hello|]# world\n");
    },
  },
  {
    name: "IME composition in insert mode inserts the composed text",
    run: () => {
      setDoc("#[h|]#ello\n");
      keys("i");
      ob("dev:cdp", "method=Input.imeSetComposition", `params=${JSON.stringify({ text: "˜", selectionStart: 1, selectionEnd: 1 })}`);
      ob("dev:cdp", "method=Input.insertText", `params=${JSON.stringify({ text: "ñ" })}`);
      Bun.sleepSync(100);
      keys("<esc>");
      expectEq("markup", state().markup, "ñ#[|h]#ello\n");
    },
  },
  {
    name: "Tab cycles path completions with spaces without piling them up",
    run: () => {
      setDoc("#[x|]#\n");
      keys(":open<space>");
      const lines: string[] = [];
      for (let i = 0; i < 4; i++) {
        keys("<tab>");
        lines.push(state().prompt!.line);
      }
      keys("<esc>");
      for (const line of lines) {
        const rest = line.slice("open ".length);
        expectTrue("one argument", /^'[^']*(?:''[^']*)*'$|^\S+$/.test(rest), line);
      }
    },
  },

  {
    name: "x reveals only its own line and still takes the line break",
    run: () => {
      const raw = () => dom(`return [...v.contentDOM.querySelectorAll(".cm-line")].map((l) => l.textContent).filter((t) => t.startsWith("- [ ]"));`);
      setDoc("- [ ] one\n- [ ] t#[w|]#o\n- [ ] three\n- [ ] four\n");
      keys("x");
      Bun.sleepSync(400);
      expectEq("only the selected line shows its markup", raw(), ["- [ ] two"]);
      evalJs(`(()=>{const cm=app.workspace.activeLeaf.view.editor.cm;cm.dispatch({selection:cm.state.selection});return 1})()`);
      Bun.sleepSync(400);
      expectEq("the same selection sent again changes nothing", state().markup, "- [ ] one\n#[- [ ] two\n|]#- [ ] three\n- [ ] four\n");
      keys("<A-;>");
      Bun.sleepSync(300);
      expectTrue("a backward selection still paints its line break", Number(dom(`return v.dom.querySelectorAll(".hx-cell-sel").length;`)) >= 1);
      keys("<A-;>");
      keys("d");
      expectEq("d takes the whole line", state().markup.replace(/#\[|\|\]#|\]#|#\[\|/g, ""), "- [ ] one\n- [ ] three\n- [ ] four\n");
    },
  },
  {
    name: "the cursor stays on the text when a list line reveals its markup",
    run: () => {
      const long = "- [ ] on a no-selection (so just one cell in normal mode), a for some reason draws a selection when beginning to write";
      setDoc(`#[I|]#ntro\n\n- [ ] short\n${long}\n\nend\n`);
      Bun.sleepSync(300);
      keys("jjmip");
      let got: unknown = false;
      for (let i = 0; i < 30 && got !== true; i++) {
        Bun.sleepSync(100);
        got = dom(`const line = v.state.doc.line(4); const c = v.dom.querySelector(".hx-cursors .hx-cell").getBoundingClientRect(); const co = v.coordsAtPos(line.to, -1); return Math.abs(c.left - co.right) < 1.5`);
      }
      expectEq("cell at the line end", got, true);
    },
  },
  {
    name: "clicking away from a selection returns its lines to Live Preview",
    run: () => {
      setDoc("#[I|]#ntro\n\n- [ ] one\n- [ ] two\n\nAfter text\n");
      Bun.sleepSync(400);
      keys("jjmip");
      Bun.sleepSync(400);
      const raw = () => dom(`return v.contentDOM.querySelectorAll(".cm-formatting-task").length`) as number;
      expectEq("revealed", raw(), 2);
      const p = dom(`const c = v.coordsAtPos(v.state.doc.line(6).from + 3, 1); return [c.left + 1, (c.top + c.bottom) / 2]`) as [number, number];
      mouse("mouseMoved", p[0], p[1]);
      mouse("mousePressed", p[0], p[1]);
      mouse("mouseReleased", p[0], p[1]);
      Bun.sleepSync(400);
      expectEq("hidden again", raw(), 0);
    },
  },
  {
    name: "x then P on a last line with no newline pastes a whole line above",
    run: () => {
      setDoc("one\n#[t|]#wo");
      keys("xyP");
      expectEq("text", (state() as unknown as { text: string }).text, "one\ntwo\ntwo");
    },
  },
  {
    name: "p of a whole line after a last line with no newline adds a line",
    run: () => {
      setDoc("#[o|]#ne\ntwo");
      keys("xyjp");
      expectEq("text", (state() as unknown as { text: string }).text, "one\ntwo\none");
    },
  },
  {
    name: "Live Preview: motions skip frontmatter, gg goes to the first text line, k focuses the properties",
    run: () => {
      setDoc("---\nkey: value\n---\nfirst\n#[s|]#econd\n");
      Bun.sleepSync(500);
      expectEq("starts on second", cursorLine(), 5);
      keys("k");
      Bun.sleepSync(200);
      expectEq("cursor on first", cursorLine(), 4);
      keys("j");
      keys("gg");
      expectEq("gg", cursorLine(), 4);
      keys("k");
      Bun.sleepSync(150);
      expectEq("properties have focus", evalJs(`app.workspace.activeLeaf.view.metadataEditor.hasFocus()`), true);
      evalJs(`(app.workspace.activeLeaf.view.editor.cm.focus(), 1)`);
    },
  },
  {
    name: "Live Preview: j and k land on an embed line instead of skipping it",
    run: () => {
      setDoc("#[a|]#bove\n\n![[Welcome]]\n\nbelow\n");
      Bun.sleepSync(700);
      keys("jj");
      expectEq("on the embed", cursorLine(), 3);
      keys("jj");
      expectEq("below", cursorLine(), 5);
      keys("kk");
      expectEq("back on the embed", cursorLine(), 3);
    },
  },
  ...tableScenarios(),
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
