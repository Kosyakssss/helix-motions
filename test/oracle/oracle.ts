import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

export interface Case {
  id: string;
  in: string;
  keys: string;
  lang?: "markdown";
}

export interface OracleResult {
  text?: string;
  ranges?: [number, number][];
  primary?: number;
  out?: string;
  mode?: string;
  register?: string[] | null;
  error?: string;
}

const CACHE = resolve(import.meta.dir, "cache.json");
const HELIX = process.env.HELIX_DIR ?? resolve(import.meta.dir, "../../../helix");

function key(c: Case): string {
  return c.lang ? `${c.in}\u0000${c.keys}\u0000${c.lang}` : `${c.in}\u0000${c.keys}`;
}

export function loadCache(): Record<string, OracleResult> {
  return existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
}

function oracleBinary(): string {
  const proc = Bun.spawnSync(
    ["cargo", "test", "-q", "-p", "helix-term", "--features", "integration", "--test", "oracle", "--no-run", "--message-format=json"],
    { cwd: HELIX, stdout: "pipe", stderr: "pipe" },
  );
  const matches = [...proc.stdout.toString().matchAll(/"executable":"([^"]*oracle-[^"]*)"/g)];
  const exe = matches[matches.length - 1]?.[1];
  if (!exe) throw new Error(`cannot build oracle: ${proc.stderr.toString().slice(-2000)}`);
  return exe;
}

export async function oracleAsync(cases: Case[]): Promise<Map<string, OracleResult>> {
  const cache = loadCache();
  const missing = cases.filter((c) => !(key(c) in cache));
  const unique = [...new Map(missing.map((c) => [key(c), c])).values()];
  if (unique.length > 0) {
    if (!existsSync(join(HELIX, "helix-term/tests/oracle.rs"))) {
      throw new Error(`Helix oracle not found in ${HELIX}; set HELIX_DIR`);
    }
    const exe = oracleBinary();
    const shards = Math.max(1, Math.min(Number(process.env.ORACLE_JOBS ?? 7), Math.ceil(unique.length / 20)));
    const dir = mkdtempSync(join(tmpdir(), "hm-oracle-"));
    const jobs = Array.from({ length: shards }, async (_, s) => {
      const part = unique.map((c, i) => ({ c, i })).filter(({ i }) => i % shards === s);
      const input = join(dir, `in${s}.json`);
      const output = join(dir, `out${s}.json`);
      writeFileSync(input, JSON.stringify(part.map(({ c, i }) => ({ id: String(i), in: c.in, keys: c.keys, lang: c.lang }))));
      const proc = Bun.spawn([exe, "--test-threads=1", "-q"], {
        cwd: join(HELIX, "helix-term"),
        env: { ...process.env, CARGO_MANIFEST_DIR: join(HELIX, "helix-term"), ORACLE_IN: input, ORACLE_OUT: output },
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      if (!existsSync(output)) throw new Error(`oracle shard ${s} failed: ${(await new Response(proc.stdout).text()).slice(-3000)} ${await new Response(proc.stderr).text()}`);
      return JSON.parse(readFileSync(output, "utf8")) as (OracleResult & { id: string })[];
    });
    for (const results of await Promise.all(jobs)) {
      for (const r of results) {
        const c = unique[Number(r.id)]!;
        const { id, ...rest } = r;
        void id;
        cache[key(c)] = rest;
      }
    }
    writeFileSync(CACHE, JSON.stringify(cache, null, 1));
  }
  return new Map(cases.map((c) => [c.id, cache[key(c)]!]));
}

export function oracleGraphemes(strings: string[]): number[][] {
  const dir = mkdtempSync(join(tmpdir(), "hm-graphemes-"));
  const input = join(dir, "in.json");
  const output = join(dir, "out.json");
  writeFileSync(input, JSON.stringify(strings));
  Bun.spawnSync([oracleBinary(), "--test-threads=1", "-q", "graphemes::graphemes"], {
    cwd: join(HELIX, "helix-term"),
    env: { ...process.env, ORACLE_GRAPHEMES_IN: input, ORACLE_GRAPHEMES_OUT: output },
  });
  return JSON.parse(readFileSync(output, "utf8")) as number[][];
}
