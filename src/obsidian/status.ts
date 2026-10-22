import type { MarkdownView } from "obsidian";
import type { HelixEditor } from "../core/editor";
import type { Host } from "../core/host";
import { helixField } from "../state";

function element(name: string, editor: HelixEditor, host: Host, view: MarkdownView | null): string | null {
  const value = host.state.field(helixField);
  const doc = host.state.doc;
  const sl = editor.config.statusline;
  switch (name) {
    case "mode":
      return value.mode === "insert" ? sl.modeInsert : value.mode === "select" ? sl.modeSelect : sl.modeNormal;
    case "file-name":
    case "file-absolute-path":
      return view?.file?.path ?? host.name;
    case "file-base-name":
      return view?.file?.name ?? host.name;
    case "file-modification-indicator":
      return null;
    case "position": {
      const cursor = value.selection.primary().cursor(doc);
      const line = doc.lineAt(cursor);
      return `${line.number}:${cursor - line.from + 1}`;
    }
    case "position-percentage": {
      const line = doc.lineAt(value.selection.primary().cursor(doc)).number;
      return `${Math.round((line / doc.lines) * 100)}%`;
    }
    case "total-line-numbers":
      return String(doc.lines);
    case "selections": {
      const n = value.selection.ranges.length;
      return n === 1 ? "1 sel" : `${value.selection.primaryIndex + 1}/${n} sels`;
    }
    case "primary-selection-length": {
      const r = value.selection.primary();
      return `${r.to() - r.from()} sel`;
    }
    case "register":
      return editor.selectedRegister ? `reg=${editor.selectedRegister}` : null;
    case "separator":
      return sl.separator;
    case "spacer":
      return " ";
    default:
      return null;
  }
}

export function renderStatus(el: HTMLElement, editor: HelixEditor, host: Host, view: MarkdownView | null): void {
  const value = host.state.field(helixField);
  const sl = editor.config.statusline;
  el.empty();
  const parts: { text: string; cls: string }[] = [];
  for (const name of [...sl.left, ...sl.center, ...sl.right]) {
    const text = element(name, editor, host, view);
    if (text !== null && text !== "") parts.push({ text, cls: name === "mode" ? `hx-status-mode hx-status-${value.mode}` : "" });
  }
  const pending = editor.pendingDisplay() + (editor.count !== null ? String(editor.count) : "");
  if (editor.macroRecording) parts.push({ text: `[${editor.macroRecording.register}]`, cls: "hx-status-macro" });
  if (pending) parts.push({ text: pending, cls: "hx-status-pending" });
  if (editor.status) parts.push({ text: editor.status.message, cls: editor.status.severity === "error" ? "hx-status-error" : "hx-status-msg" });
  for (const p of parts) {
    const span = el.createSpan({ text: p.text, cls: p.cls });
    if (p.cls.includes("hx-status-mode") && editor.config.colorModes) span.addClass("hx-color");
  }
}
