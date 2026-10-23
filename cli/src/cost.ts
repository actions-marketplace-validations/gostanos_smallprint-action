/**
 * `smallprint cost` (decision 601): what each MCP server's tool definitions cost a model on every request that carries
 * them. The tools are read the way `check --live` reads them (a hosted server is asked over HTTP; a local server is
 * started only after the commands are shown and the person answers yes), then sent to Anthropic's token counter with
 * the person's own key, ANTHROPIC_API_KEY. Anthropic does not charge for counting (its token counting docs, read 18 Oct
 * 2026). Nothing goes to smallprint.dev. A count is the definitions alone: the same one-word message with no tools, and
 * the fixed instructions Anthropic adds once whenever a request has any tools, are taken away, as in the context-cost
 * lab (tools/lab/context-cost/count.py). Haiku 5.5, Sonnet 5.5, Opus 5.5 and Fable 5.1 counted the same definitions to
 * the same number in that lab, so the count is made once and priced for each.
 */
import type { ServedTool } from "./live";

export const COUNT_MODEL = "claude-haiku-5-5";
const COUNT_URL = "https://api.anthropic.com/v1/messages/count_tokens";

/** Input prices per million tokens, from Anthropic's pricing page as read on PRICES_READ. Haiku 5.5 charges more for the
 * whole prompt once a prompt is over 100,000 tokens; the others charge one price across their context window. */
export const PRICES_READ = "21 Oct 2026";
export const PRICES: readonly { model: string; perMillion: number; over100k?: number }[] = [
  { model: "Haiku 5.5", perMillion: 0.1, over100k: 0.5 },
  { model: "Sonnet 5.5", perMillion: 2 },
  { model: "Opus 5.5", perMillion: 4 },
  { model: "Fable 5.1", perMillion: 10 },
];

export interface AnthropicTool { name: string; description: string; input_schema: Record<string, unknown> }

/** A served tool in the form Anthropic's API takes: a name it accepts, the description, and an object schema. */
export function anthropicTool(t: ServedTool): AnthropicTool {
  const s = t.inputSchema;
  const schema = s && typeof s === "object" && !Array.isArray(s) && (s as { type?: unknown }).type === "object" ? (s as Record<string, unknown>) : { type: "object", properties: {} };
  return { name: (t.name.replace(/[^a-zA-Z0-9_-]/g, "_") || "_").slice(0, 128), description: t.description, input_schema: schema };
}

export class CountRefused extends Error {}

/** One call to the token counter: the input tokens of a one-word message, with these tools or none. */
export async function countTokens(key: string, tools: readonly AnthropicTool[] | null, f: typeof fetch = fetch): Promise<number> {
  const body: Record<string, unknown> = { model: COUNT_MODEL, messages: [{ role: "user", content: "hi" }] };
  if (tools) body.tools = tools;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await f(COUNT_URL, { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    if (r.ok) return ((await r.json()) as { input_tokens: number }).input_tokens;
    if (r.status === 401 || r.status === 403) throw new CountRefused(`Anthropic answered HTTP ${r.status} to the key in ANTHROPIC_API_KEY`);
    if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1))); continue; }
    const why = await r.text().catch(() => "");
    let message = why.slice(0, 300);
    try { message = (JSON.parse(why) as { error?: { message?: string } }).error?.message ?? message; } catch { /* not JSON */ }
    throw new CountRefused(`Anthropic refused these definitions (HTTP ${r.status}): ${message}`);
  }
  throw new CountRefused("Anthropic's token counter kept answering busy");
}

/** The two fixed amounts every count takes away: the message alone, and the instructions added for any tools. */
export interface Baseline { message: number; toolUse: number }

export async function measureBaseline(key: string, f: typeof fetch = fetch): Promise<Baseline> {
  const empty: AnthropicTool = { name: "x", description: "", input_schema: { type: "object", properties: {} } };
  const message = await countTokens(key, null, f);
  const one = await countTokens(key, [empty], f);
  const two = await countTokens(key, [empty, { ...empty, name: "y" }], f);
  return { message, toolUse: one - message - (two - one) };
}

/** What a server's definitions cost, in tokens. A server with no tools costs nothing and is not sent. */
export async function definitionTokens(key: string, tools: readonly ServedTool[], base: Baseline, f: typeof fetch = fetch): Promise<number> {
  if (!tools.length) return 0;
  return (await countTokens(key, tools.map(anthropicTool), f)) - base.message - base.toolUse;
}

/** Dollars for this many input tokens on one request, at the price a prompt of `promptTokens` pays. */
export function dollars(tokens: number, p: (typeof PRICES)[number], promptTokens = tokens): number {
  const rate = p.over100k !== undefined && promptTokens > 100_000 ? p.over100k : p.perMillion;
  return (tokens * rate) / 1_000_000;
}

export const money = (d: number): string => (d < 0.01 ? `$${d.toFixed(4)}` : `$${d.toFixed(2)}`);

export interface CostRow { name: string; tools: number; tokens: number | null; why?: string }

/** The table and the closing lines, as printed. */
export function costLines(rows: readonly CostRow[], base: Baseline): string[] {
  const counted = rows.filter((r): r is CostRow & { tokens: number } => r.tokens !== null);
  const total = counted.reduce((a, r) => a + r.tokens, 0);
  const width = Math.max(6, ...rows.map((r) => r.name.length));
  const out = [`${"server".padEnd(width)}  tools  ${"tokens".padStart(7)}  ${PRICES.map((p) => p.model.padStart(11)).join("")}`];
  for (const r of [...rows].sort((a, b) => (b.tokens ?? -1) - (a.tokens ?? -1))) {
    if (r.tokens === null) { out.push(`${r.name.padEnd(width)}  ${r.why ?? "not counted"}`); continue; }
    const t = r.tokens;
    out.push(`${r.name.padEnd(width)}  ${String(r.tools).padStart(5)}  ${t.toLocaleString("en-US").padStart(7)}  ${PRICES.map((p) => money(dollars(t, p, total + base.toolUse)).padStart(11)).join("")}`);
  }
  out.push("");
  out.push(`All ${counted.length} together: ${total.toLocaleString("en-US")} tokens on every request that carries them, plus ${base.toolUse} Anthropic adds once for tool use.`);
  out.push(`Per request without caching: ${PRICES.map((p) => `${p.model} ${money(dollars(total, p, total + base.toolUse))}`).join(", ")}.`);
  if (total + base.toolUse > 100_000) out.push("That is over 100,000 tokens before your agent says anything, so every Haiku 5.5 request pays its higher price for the whole prompt.");
  out.push(`Prices are Anthropic's input prices as read on ${PRICES_READ}; a client that caches its prompt pays much less to read the definitions again. Counted on ${COUNT_MODEL}; in Small Print's lab the other three counted the same definitions to the same number.`);
  return out;
}
