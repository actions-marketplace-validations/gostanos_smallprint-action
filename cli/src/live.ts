/**
 * `smallprint check --live` (decision 269): ask each MCP server on this machine what tools it serves right
 * now, and compare the names and descriptions with what Small Print recorded for that exact version. A hosted server is
 * asked over HTTP, the way an agent asks it; a local server is started only with --live-local, after the exact commands
 * are shown and the person answers yes, because starting it runs its code. What the servers answer stays on this
 * machine: the command sends a registry name, a version or a host to look up the record, as the check and the gate do.
 * Names and descriptions are compared, not input schemas: the record reads a local server's schemas from its published
 * code and a running server states them in its own form, so the two can differ without any change to what it says.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DiscoveredServer } from "./parse";

export interface ServedTool { name: string; description: string }
export interface RecordTool { name: string; descriptionSha256: string }

const PROTOCOL_VERSION = "2025-06-18";
const WS = /\s+/g;
const MAX_TEXT = 20_000;

/** The record's canonical form for a name or a description: whitespace collapsed, trimmed, capped (packages/normalize/src/canonical.ts). */
export function canonicalText(s: string): string {
  const t = s.replace(WS, " ").trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)} [truncated]` : t;
}
/** A tool name in the record's canonical form: whitespace collapsed and trimmed, never capped. */
export const canonicalName = (s: string): string => s.replace(WS, " ").trim();
export const descriptionHash = (description: string): string => createHash("sha256").update(canonicalText(description), "utf8").digest("hex");

export interface ToolComparison { same: boolean; added: string[]; removed: string[]; changed: string[] }

/** What the server serves against what the record holds for that version, by tool name and description hash. */
export function compareTools(served: readonly ServedTool[], recorded: readonly RecordTool[]): ToolComparison {
  const now = new Map(served.map((t) => [canonicalName(t.name), descriptionHash(t.description)]));
  const then = new Map(recorded.map((t) => [t.name, t.descriptionSha256]));
  const added = [...now.keys()].filter((n) => !then.has(n)).sort();
  const removed = [...then.keys()].filter((n) => !now.has(n)).sort();
  const changed = [...now.keys()].filter((n) => then.has(n) && then.get(n) !== now.get(n)).sort();
  return { same: !added.length && !removed.length && !changed.length, added, removed, changed };
}

/** An address without its query string, fragment or trailing slash, for matching a configured URL to the registry's. */
export function plainUrl(u: string): string | null {
  try {
    const x = new URL(u);
    return `${x.protocol}//${x.host.toLowerCase()}${x.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export interface Launch { command: string; args: string[]; env: Record<string, string>; url: string | null }

/** How the agent starts or reaches this server, read again from its own config file on this machine. Never sent anywhere. */
export function launchFor(s: DiscoveredServer): Launch | null {
  let j: unknown;
  try { j = JSON.parse(readFileSync(s.configPath, "utf8")); } catch { return null; }
  const pools: unknown[] = [];
  const o = j as Record<string, unknown>;
  for (const k of ["mcpServers", "servers", "context_servers"]) if (o && typeof o[k] === "object") pools.push(o[k]);
  if (o && typeof o.projects === "object" && o.projects) for (const p of Object.values(o.projects as Record<string, unknown>)) if (p && typeof (p as Record<string, unknown>).mcpServers === "object") pools.push((p as Record<string, unknown>).mcpServers);
  for (const pool of pools) {
    const e = (pool as Record<string, unknown>)[s.name] as Record<string, unknown> | undefined;
    if (!e || typeof e !== "object") continue;
    const url = typeof e.url === "string" ? e.url : typeof e.serverUrl === "string" ? e.serverUrl : null;
    const cmd = typeof e.command === "string" ? e.command : typeof (e.command as Record<string, unknown>)?.path === "string" ? String((e.command as Record<string, unknown>).path) : "";
    const args = Array.isArray(e.args) ? e.args.filter((a): a is string => typeof a === "string") : [];
    const env: Record<string, string> = {};
    if (e.env && typeof e.env === "object") for (const [k, v] of Object.entries(e.env as Record<string, unknown>)) if (typeof v === "string") env[k] = v;
    return { command: cmd, args, env, url };
  }
  return null;
}

const rpc = (id: number, method: string, params: unknown = {}) => JSON.stringify({ jsonrpc: "2.0", id, method, params });
const initParams = { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "smallprint-live", version: "1" } };
type Rpc = { id?: number; result?: { tools?: { name?: unknown; description?: unknown }[]; nextCursor?: string }; error?: { message?: string } };
const toServed = (tools: { name?: unknown; description?: unknown }[] | undefined): ServedTool[] => (tools ?? []).map((t) => ({ name: String(t.name ?? ""), description: String(t.description ?? "") }));

/** Parse a streamable HTTP answer, JSON or a text/event-stream carrying JSON in its data lines, and return the reply with this id. */
async function reply(res: Response, id: number): Promise<Rpc | null> {
  const text = await res.text();
  const bodies = (res.headers.get("content-type") ?? "").includes("text/event-stream") ? text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()) : [text];
  for (const b of bodies) {
    try {
      const j = JSON.parse(b) as Rpc | Rpc[];
      for (const m of Array.isArray(j) ? j : [j]) if (m && m.id === id) return m;
    } catch { /* not JSON */ }
  }
  return null;
}

export type LiveRead = { ok: true; tools: ServedTool[] } | { ok: false; why: string };

/** A hosted server, over streamable HTTP: initialize, initialized, tools/list with its pages. Nothing else is called. */
export async function readHttp(url: string, timeoutMs = 15_000, f: typeof fetch = fetch): Promise<LiveRead> {
  const base: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": PROTOCOL_VERSION, "user-agent": "smallprint-live/1" };
  const post = (body: string, session: string | null) => f(url, { method: "POST", headers: session ? { ...base, "mcp-session-id": session } : base, body, signal: AbortSignal.timeout(timeoutMs) });
  let first: Response;
  try { first = await post(rpc(1, "initialize", initParams), null); } catch (e) { return { ok: false, why: `no answer (${(e as Error).message})` }; }
  if (first.status === 401 || first.status === 403) return { ok: false, why: "it asks for a sign-in, which the live check does not do" };
  if (first.status === 404 || first.status === 405) return { ok: false, why: "it does not speak streamable HTTP (an older SSE server); the live check does not read those yet" };
  if (!first.ok) return { ok: false, why: `initialize answered ${first.status}` };
  const session = first.headers.get("mcp-session-id");
  const init = await reply(first, 1);
  if (!init?.result) return { ok: false, why: init?.error?.message ? `initialize: ${init.error.message}` : "initialize gave no result" };
  await post(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), session).then((r) => r.text()).catch(() => undefined);
  const tools: ServedTool[] = [];
  let cursor: string | undefined;
  for (let id = 2; id < 22; id++) {
    const res = await post(rpc(id, "tools/list", cursor ? { cursor } : {}), session).catch((e: Error) => e);
    if (res instanceof Error) return { ok: false, why: `tools/list: ${res.message}` };
    if (res.status === 401 || res.status === 403) return { ok: false, why: "tools/list asks for a sign-in, which the live check does not do" };
    const m = await reply(res, id);
    if (!m?.result) return { ok: false, why: m?.error?.message ? `tools/list: ${m.error.message}` : "tools/list gave no result" };
    tools.push(...toServed(m.result.tools));
    cursor = m.result.nextCursor;
    if (!cursor) break;
  }
  if (session) await f(url, { method: "DELETE", headers: { "mcp-session-id": session, "user-agent": "smallprint-live/1" }, signal: AbortSignal.timeout(5000) }).catch(() => undefined);
  return { ok: true, tools };
}

/** The events of a text/event-stream so far: the endpoint event's address, and every JSON-RPC message in a data line. */
export function sseEvents(text: string): { endpoint: string | null; messages: Rpc[] } {
  let endpoint: string | null = null;
  const messages: Rpc[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const ev = /^event:\s*(.*)$/m.exec(block)?.[1]?.trim() ?? "message";
    const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
    if (!data) continue;
    if (ev === "endpoint") endpoint = data;
    else { try { const m = JSON.parse(data) as Rpc; if (m && typeof m === "object") messages.push(m); } catch { /* not JSON */ } }
  }
  return { endpoint, messages };
}

/** A hosted server on the older SSE transport: open the stream, take the endpoint it names, post to it, read the replies on the stream. */
export async function readSse(url: string, timeoutMs = 15_000, f: typeof fetch = fetch): Promise<LiveRead> {
  let stream: Response;
  try { stream = await f(url, { method: "GET", headers: { accept: "text/event-stream", "user-agent": "smallprint-live/1" }, signal: AbortSignal.timeout(timeoutMs * 3) }); } catch (e) { return { ok: false, why: `no answer (${(e as Error).message})` }; }
  if (stream.status === 401 || stream.status === 403) return { ok: false, why: "it asks for a sign-in, which the live check does not do" };
  if (!stream.ok || !(stream.headers.get("content-type") ?? "").includes("text/event-stream") || !stream.body) return { ok: false, why: `its stream answered ${stream.status}` };
  const reader = stream.body.getReader();
  const dec = new TextDecoder();
  let text = "";
  const started = Date.now();
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  const pump = async (until: (t: string) => boolean): Promise<boolean> => {
    while (Date.now() - started < timeoutMs * 2) {
      if (until(text)) return true;
      pending ??= reader.read();
      const got = await Promise.race([pending, new Promise<null>((r) => setTimeout(() => r(null), 500))]);
      if (got === null) continue;
      pending = null;
      if (got.done) return until(text);
      text += dec.decode(got.value, { stream: true });
      if (text.length > 5_000_000) return false;
    }
    return until(text);
  };
  try {
    if (!(await pump((t) => sseEvents(t).endpoint !== null))) return { ok: false, why: "its stream named no endpoint" };
    const target = new URL(sseEvents(text).endpoint!, url);
    if (target.host !== new URL(url).host) return { ok: false, why: "its endpoint is on another host, so it was not followed" };
    const post = (body: string) => f(target.toString(), { method: "POST", headers: { "content-type": "application/json", "user-agent": "smallprint-live/1" }, body, signal: AbortSignal.timeout(timeoutMs) });
    const r1 = await post(rpc(1, "initialize", initParams));
    await r1.text().catch(() => "");
    if (!r1.ok) return { ok: false, why: `initialize answered ${r1.status}` };
    if (!(await pump((t) => sseEvents(t).messages.some((m) => m.id === 1)))) return { ok: false, why: "initialize gave no reply on the stream" };
    await post(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })).then((r) => r.text()).catch(() => undefined);
    const r2 = await post(rpc(2, "tools/list", {}));
    await r2.text().catch(() => "");
    if (!r2.ok) return { ok: false, why: `tools/list answered ${r2.status}` };
    if (!(await pump((t) => sseEvents(t).messages.some((m) => m.id === 2)))) return { ok: false, why: "tools/list gave no reply on the stream" };
    const m = sseEvents(text).messages.find((x) => x.id === 2);
    if (!m?.result) return { ok: false, why: m?.error?.message ? `tools/list: ${m.error.message}` : "tools/list gave no result" };
    return { ok: true, tools: toServed(m.result.tools) };
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Streamable HTTP first; a server that refuses it with 404 or 405, or whose address ends in /sse, is read over the older SSE transport. */
export async function readHosted(url: string, timeoutMs = 15_000, f: typeof fetch = fetch): Promise<LiveRead> {
  if (/\/sse\/?$/.test(new URL(url).pathname)) return readSse(url, timeoutMs, f);
  const r = await readHttp(url, timeoutMs, f);
  if (!r.ok && /older SSE server/.test(r.why)) return readSse(url, timeoutMs, f);
  return r;
}

/** A local server, over stdio: started with the config's own command, arguments and environment, asked for its tools, stopped. */
export function readStdio(l: Launch, timeoutMs = 20_000): Promise<LiveRead> {
  return new Promise((resolve) => {
    if (!l.command) return resolve({ ok: false, why: "no command in the config" });
    let done = false;
    const child = spawn(l.command, l.args, { env: { ...process.env, ...l.env }, stdio: ["pipe", "pipe", "ignore"], shell: process.platform === "win32" });
    const finish = (r: LiveRead) => { if (done) return; done = true; clearTimeout(timer); try { child.kill(); } catch { /* gone */ } resolve(r); };
    const timer = setTimeout(() => finish({ ok: false, why: `no answer in ${Math.round(timeoutMs / 1000)} s` }), timeoutMs);
    child.on("error", (e) => finish({ ok: false, why: `could not start it (${e.message})` }));
    child.on("exit", (code) => finish({ ok: false, why: `it exited (code ${code}) before listing its tools` }));
    const tools: ServedTool[] = [];
    let buf = "";
    let nextId = 2;
    const send = (s: string) => { try { child.stdin.write(`${s}\n`); } catch { /* closed */ } };
    child.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let m: Rpc;
        try { m = JSON.parse(line) as Rpc; } catch { continue; }
        if (m.id === 1) {
          if (!m.result) return finish({ ok: false, why: m.error?.message ? `initialize: ${m.error.message}` : "initialize gave no result" });
          send(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
          send(rpc(nextId, "tools/list", {}));
        } else if (m.id === nextId) {
          if (!m.result) return finish({ ok: false, why: m.error?.message ? `tools/list: ${m.error.message}` : "tools/list gave no result" });
          tools.push(...toServed(m.result.tools));
          if (m.result.nextCursor && nextId < 21) { nextId++; send(rpc(nextId, "tools/list", { cursor: m.result.nextCursor })); }
          else finish({ ok: true, tools });
        }
      }
    });
    send(rpc(1, "initialize", initParams));
  });
}
