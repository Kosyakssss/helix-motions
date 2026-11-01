import { RustRegexEngine } from "../core/rx";

const base64 = Uint8Array as unknown as { fromBase64?(data: string): ReturnType<typeof Uint8Array.from> };

export async function unpack(data: string): Promise<Uint8Array> {
  const bytes = base64.fromBase64 ? base64.fromBase64(data) : Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function loadRegex(): Promise<RustRegexEngine> {
  const { default: packed } = await import("../../regex/regex.wasm");
  return RustRegexEngine.load(await unpack(packed));
}
