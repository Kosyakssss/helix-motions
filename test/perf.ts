import { makeEditor, makeHost } from "./harness";
const n = Number(process.argv[2] ?? 20000);
const lines: string[] = [];
for (let i = 0; i < n; i++) lines.push(`line ${i} some words here with **bold** and [[link]] text`);
let t = performance.now();
const host = makeHost("#[l|]#" + lines.join("\n").slice(1) + "\n");
const editor = makeEditor();
host.onChanges = (c) => editor.docChanged(host, c);
console.log("load", (performance.now() - t).toFixed(1));
for (const k of ["w", "j", "x", "5j", "mi(", "/link<ret>", "n", "gg", "ge", "ifoo<esc>", "u", "%", "<A-s>", ";", ","]) {
  t = performance.now();
  editor.feedKeys(host, k);
  console.log(k.padEnd(12), (performance.now() - t).toFixed(1), "ms");
}
