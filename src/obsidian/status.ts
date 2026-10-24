import { FileSystemAdapter, type MarkdownView } from "obsidian";
import type { HelixEditor } from "../core/editor";
import type { Host } from "../core/host";
import { helixField } from "../state";
import { unresolvedIn } from "./workspace";
import { nextGraphemeBoundary } from "../graphemes";

type Part = { text: string; cls?: string };

function severityCounts(severities: string[], warnings: number, prefix: Part[]): Part[] {
  const parts: Part[] = [];
  for (const severity of severities) {
    if (severity === "warning" && warnings > 0) parts.push({ text: "●", cls: "hx-status-warning" }, { text: ` ${warnings} ` });
  }
  return parts.length > 0 ? [...prefix, ...parts] : [];
}

function vaultWarnings(view: MarkdownView): number {
  let total = 0;
  for (const links of Object.values(view.app.metadataCache.unresolvedLinks)) {
    for (const count of Object.values(links)) total += count;
  }
  return total;
}

function element(name: string, editor: HelixEditor, host: Host, view: MarkdownView | null): Part[] {
  const value = host.state.field(helixField);
  const doc = host.state.doc;
  const sl = editor.config.statusline;
  const cursor = value.selection.primary().cursor(doc);
  switch (name) {
    case "mode": {
      const mode = value.mode === "insert" ? sl.modeInsert : value.mode === "select" ? sl.modeSelect : sl.modeNormal;
      return [{ text: ` ${mode} `, cls: `hx-status-mode hx-status-${value.mode}${editor.config.colorModes ? " hx-color" : ""}` }];
    }
    case "file-name":
      return [{ text: ` ${view?.file?.path ?? host.name} `, cls: "hx-status-file" }];
    case "file-absolute-path": {
      const adapter = view?.app.vault.adapter;
      const base = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
      return [{ text: ` ${view?.file ? `${base}/${view.file.path}` : host.name} `, cls: "hx-status-file" }];
    }
    case "file-base-name":
      return [{ text: ` ${view?.file?.name ?? host.name} `, cls: "hx-status-file" }];
    case "file-modification-indicator":
      return [{ text: "[+]", cls: (view as unknown as { dirty?: boolean } | null)?.dirty ? undefined : "hx-status-reserved" }];
    case "file-line-ending":
      return [{ text: " LF " }];
    case "file-indent-style": {
      const style = editor.config.indentStyle;
      return [{ text: style.kind === "tabs" ? " tabs " : ` ${style.width} space${style.width === 1 ? "" : "s"} ` }];
    }
    case "file-type":
      return [{ text: " markdown " }];
    case "diagnostics": {
      const warnings = view?.file ? unresolvedIn(view.app, view.file).length : 0;
      return severityCounts(sl.diagnostics, warnings, []);
    }
    case "workspace-diagnostics":
      return view ? severityCounts(sl.workspaceDiagnostics, vaultWarnings(view), [{ text: " W " }]) : [];
    case "selections": {
      const n = value.selection.ranges.length;
      return [{ text: n === 1 ? " 1 sel " : ` ${value.selection.primaryIndex + 1}/${n} sels ` }];
    }
    case "primary-selection-length": {
      const r = value.selection.primary();
      const chars = [...doc.sliceString(r.from(), r.to())].length;
      return [{ text: ` ${chars} char${chars === 1 ? "" : "s"} ` }];
    }
    case "position": {
      const line = doc.lineAt(cursor);
      let col = 0;
      for (let pos = line.from; pos < cursor; pos = nextGraphemeBoundary(doc, pos)) col++;
      return [{ text: ` ${line.number}:${col + 1} ` }];
    }
    case "position-percentage":
      return [{ text: `${Math.floor((doc.lineAt(cursor).number * 100) / doc.lines)}%` }];
    case "total-line-numbers":
      return [{ text: ` ${doc.lines} ` }];
    case "register":
      return editor.selectedRegister ? [{ text: ` reg=${editor.selectedRegister} ` }] : [];
    case "current-working-directory":
      return view ? [{ text: view.app.vault.getName() }] : [];
    case "separator":
      return [{ text: sl.separator, cls: "hx-status-separator" }];
    default:
      return [];
  }
}

function trim(parts: Part[]): Part[] {
  const out = parts.map((part) => ({ ...part }));
  if (out.length > 0) {
    out[0]!.text = out[0]!.text.trimStart();
    out[out.length - 1]!.text = out[out.length - 1]!.text.trimEnd();
  }
  return out.filter((part) => part.text !== "");
}

let probe: CanvasRenderingContext2D | null = null;
const luminances = new Map<string, number>();

function luminance(color: string): number {
  const cached = luminances.get(color);
  if (cached !== undefined) return cached;
  probe ??= createEl("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe) return 0;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = [...probe.getImageData(0, 0, 1, 1).data].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const value = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  luminances.set(color, value);
  return value;
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function inks(style: CSSStyleDeclaration): Record<string, string> {
  const light = luminance(style.getPropertyValue("--background-primary"));
  const dark = luminance(style.getPropertyValue("--text-normal"));
  const props: Record<string, string> = {};
  for (const mode of ["normal", "insert", "select"]) {
    const bg = luminance(style.getPropertyValue(`--hx-mode-${mode}`));
    props[`--hx-ink-${mode}`] = contrast(bg, light) >= contrast(bg, dark) ? "var(--background-primary)" : "var(--text-normal)";
  }
  return props;
}

export function renderStatus(el: HTMLElement, editor: HelixEditor, host: Host, view: MarkdownView | null): void {
  const sl = editor.config.statusline;
  const bar = el.parentElement;
  if (bar) {
    const style = getComputedStyle(bar);
    const rect = bar.getBoundingClientRect();
    el.toggleClass("hx-status-full", rect.left < 1);
    el.setCssProps({
      "--hx-bar-pad-top": style.paddingTop,
      "--hx-bar-pad-bottom": style.paddingBottom,
      "--hx-bar-pad-left": style.paddingLeft,
      "--hx-bar-radius": style.borderTopLeftRadius,
      "--hx-bar-border-width": style.borderTopWidth,
      "--hx-bar-border-left": style.borderLeftWidth,
      "--hx-bar-border-color": style.borderTopColor,
      ...inks(getComputedStyle(el)),
    });
  }
  el.empty();
  const strip = el.createDiv({ cls: "hx-status-strip" });
  const pending = (editor.count !== null ? String(editor.count) : "") + editor.pendingDisplay();
  if (pending) strip.createSpan({ text: pending, cls: "hx-status-pending" });
  if (editor.macroRecording) strip.createSpan({ text: `[${editor.macroRecording.register}]`, cls: "hx-status-macro" });
  strip.toggleClass("hx-hidden", strip.childElementCount === 0);
  for (const group of [sl.left, sl.center, sl.right]) {
    const box = el.createSpan({ cls: "hx-status-group" });
    for (const name of group) {
      if (name === "spacer") {
        box.createSpan({ cls: "hx-status-item" });
        continue;
      }
      const parts = trim(element(name, editor, host, view));
      if (parts.length === 0) continue;
      const item = box.createSpan({ cls: "hx-status-item" });
      for (const part of parts) item.createSpan({ text: part.text, cls: part.cls });
    }
  }
}
