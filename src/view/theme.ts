import { EditorView } from "@codemirror/view";

const fg = "var(--hx-fg, currentColor)";
const bg = "var(--hx-bg, Canvas)";
const selection = "var(--hx-selection, color-mix(in srgb, Highlight 35%, transparent))";
const error = "var(--hx-error, #d32f2f)";
const muted = "var(--hx-muted, color-mix(in srgb, currentColor 60%, transparent))";
const panel = "var(--hx-panel, color-mix(in srgb, currentColor 5%, Canvas))";
const border = "var(--hx-border, color-mix(in srgb, currentColor 20%, transparent))";
const hover = "var(--hx-hover, color-mix(in srgb, currentColor 8%, transparent))";
const radius = "var(--hx-cursor-radius, 2px)";

export const helixTheme = EditorView.baseTheme({
  "&.hx.hx-normal .cm-content, &.hx.hx-select .cm-content": { caretColor: "transparent" },
  "&.hx.hx-normal .cm-cursorLayer, &.hx.hx-select .cm-cursorLayer, &.hx.hx-insert.hx-shape-block .cm-cursorLayer, &.hx.hx-insert.hx-shape-underline .cm-cursorLayer, &.hx.hx-insert.hx-shape-hidden .cm-cursorLayer":
    { display: "none" },
  "&.hx.hx-insert .cm-cursor-secondary": { display: "none" },
  "&.hx .cm-selectionLayer": { display: "none" },
  "& ::highlight(hx-sel)": { backgroundColor: selection },
  ".cm-layer .hx-cell": {
    position: "absolute",
    left: "var(--hx-cell-left)",
    top: "var(--hx-cell-top)",
    width: "var(--hx-cell-width)",
    height: "var(--hx-cell-height)",
    borderRadius: radius,
    pointerEvents: "none",
  },
  ".cm-layer .hx-cell-block": {
    borderRadius: "0",
    backgroundColor: "var(--hx-cell-backdrop)",
    backgroundImage: "var(--hx-cell-backdrop-image)",
  },
  ".cm-layer .hx-cell-block::before": {
    content: '""',
    position: "absolute",
    inset: "0",
    borderRadius: radius,
    backgroundColor: `color-mix(in srgb, ${fg} 45%, ${bg})`,
  },
  ".cm-layer .hx-cell-block.hx-cell-primary::before": { backgroundColor: fg },
  ".cm-layer .hx-cell-sq-tl, .cm-layer .hx-cell-sq-tl::before": { borderTopLeftRadius: "0" },
  ".cm-layer .hx-cell-sq-tr, .cm-layer .hx-cell-sq-tr::before": { borderTopRightRadius: "0" },
  ".cm-layer .hx-cell-sq-bl, .cm-layer .hx-cell-sq-bl::before": { borderBottomLeftRadius: "0" },
  ".cm-layer .hx-cell-sq-br, .cm-layer .hx-cell-sq-br::before": { borderBottomRightRadius: "0" },
  ".cm-layer .hx-cell-underline": { boxShadow: `inset 0 -2px 0 ${fg}` },
  ".cm-layer .hx-cell-bar": { boxShadow: `inset 2px 0 0 ${fg}` },
  ".cm-layer .hx-cell-sel": { backgroundColor: selection, borderRadius: "0" },
  ".cm-layer .hx-cell-glyph": {
    position: "absolute",
    left: "0",
    top: "var(--hx-glyph-top)",
    height: "var(--hx-glyph-height)",
    font: "var(--hx-glyph-font)",
    lineHeight: "var(--hx-glyph-height)",
    letterSpacing: "var(--hx-glyph-spacing)",
    fontFeatureSettings: "var(--hx-glyph-features)",
    fontVariationSettings: "var(--hx-glyph-variations)",
    whiteSpace: "pre",
    color: bg,
  },
  "&.hx .hx-jump-label": { color: error, whiteSpace: "pre" },
  "&.hx .hx-cursorline": { backgroundColor: hover },
  ".hx-panel": {
    position: "relative",
    fontFamily: "var(--hx-panel-font, monospace)",
    fontSize: "var(--hx-panel-font-size, 0.85em)",
    background: panel,
    borderTop: `1px solid ${border}`,
  },
  ".hx-panel.hx-panel-empty": { borderTop: "none" },
  ".hx-panel > .hx-hidden": { display: "none" },
  ".hx-autoinfo": {
    position: "absolute",
    right: "12px",
    bottom: "calc(100% + 8px + var(--hx-autoinfo-lift, 0px))",
    padding: "6px 12px",
    maxHeight: "min(60vh, var(--hx-autoinfo-room, 60vh))",
    maxWidth: "calc(100% - 24px)",
    overflow: "auto",
    background: panel,
    border: `1px solid ${border}`,
    borderRadius: "var(--hx-radius, 4px)",
    boxShadow: "var(--hx-shadow, 0 2px 8px rgb(0 0 0 / 0.15))",
    whiteSpace: "nowrap",
  },
  ".hx-autoinfo-title": { fontWeight: "600", textAlign: "center", marginBottom: "4px" },
  ".hx-autoinfo-row": { display: "flex", gap: "1.5em" },
  ".hx-autoinfo-key": { minWidth: "3em", color: "var(--hx-accent, LinkText)" },
  ".hx-autoinfo-unavailable": { opacity: "0.45" },
  ".hx-prompt, .hx-message": {
    padding: "3px calc(10px + var(--hx-bar-overlap, 0px)) 3px 10px",
    whiteSpace: "pre",
  },
  ".hx-message": { overflow: "hidden", textOverflow: "ellipsis" },
  ".hx-message-error": { color: error },
  ".hx-prompt-label": { color: muted, marginRight: "0.25em" },
  ".hx-prompt-cursor": { background: fg, color: bg },
  ".hx-completions": { display: "flex", flexWrap: "wrap", gap: "0 1.5em", paddingBottom: "3px", color: muted },
  ".hx-completion-selected": { color: fg, background: hover },
});
