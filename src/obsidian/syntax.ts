import packedTreeSitter from "../../tree-sitter/tree-sitter.wasm";
import packedRegex from "../../regex/regex.wasm";
import { createLoader, SyntaxCache } from "../syntax/languages";
import { RustRegexEngine } from "../core/rx";

async function unpack(data: string): Promise<Uint8Array> {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function loadSyntax(): Promise<SyntaxCache> {
  return new SyntaxCache(await createLoader(await unpack(packedTreeSitter)));
}

export async function loadRegex(): Promise<RustRegexEngine> {
  return RustRegexEngine.load(await unpack(packedRegex));
}
