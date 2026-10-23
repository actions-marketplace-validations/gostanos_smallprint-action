import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { anthropicTool, costLines, countTokens, CountRefused, definitionTokens, dollars, measureBaseline, PRICES } from "../src/cost";

/** A stand-in token counter: 8 for the message, 300 the first time any tools appear, then 10 per tool plus a character per 4 of each description. */
function fakeCounter(status = 200, body?: string): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    if (status !== 200) return new Response(body ?? "{}", { status });
    const b = JSON.parse(String(init?.body)) as { tools?: { description: string }[] };
    const tools = b.tools ?? [];
    const n = 8 + (tools.length ? 300 : 0) + tools.reduce((a, t) => a + 10 + Math.ceil(t.description.length / 4), 0);
    return new Response(JSON.stringify({ input_tokens: n }), { status: 200 });
  }) as typeof fetch;
}

const haiku = PRICES.find((p) => p.model === "Haiku 5.5")!;
const sonnet = PRICES.find((p) => p.model === "Sonnet 5.5")!;

describe("smallprint cost (decision 601)", () => {
  it("sends a name Anthropic accepts and an object schema, whatever the server served", () => {
    expect(anthropicTool({ name: "files.read/v2", description: "d", inputSchema: { type: "object", properties: { p: { type: "string" } } } })).toEqual({ name: "files_read_v2", description: "d", input_schema: { type: "object", properties: { p: { type: "string" } } } });
    expect(anthropicTool({ name: "x", description: "", inputSchema: undefined }).input_schema).toEqual({ type: "object", properties: {} });
    expect(anthropicTool({ name: "x", description: "", inputSchema: { type: "string" } }).input_schema).toEqual({ type: "object", properties: {} });
  });

  it("takes away the message and the tool-use instructions, so a count is the definitions alone", async () => {
    const f = fakeCounter();
    const base = await measureBaseline("k", f);
    expect(base).toEqual({ message: 8, toolUse: 300 });
    expect(await definitionTokens("k", [{ name: "a", description: "x".repeat(40) }, { name: "b", description: "" }], base, f)).toBe(10 + 10 + 10);
    expect(await definitionTokens("k", [], base, f)).toBe(0);
  });

  it("prices Haiku 5.5 at its higher rate for the whole prompt once the prompt is over 100,000 tokens, and the others at one rate", () => {
    expect(dollars(50_000, haiku)).toBeCloseTo(0.005);
    expect(dollars(50_000, haiku, 120_000)).toBeCloseTo(0.025);
    expect(dollars(123_813, sonnet)).toBeCloseTo(0.2476, 4);
  });

  it("says a refused key and a refused definition as what they are", async () => {
    await expect(countTokens("k", null, fakeCounter(401))).rejects.toThrow(/HTTP 401 to the key in ANTHROPIC_API_KEY/);
    await expect(countTokens("k", null, fakeCounter(400, JSON.stringify({ error: { message: "tools.3.custom.input_schema: JSON schema is invalid" } })))).rejects.toThrow(CountRefused);
    await expect(countTokens("k", null, fakeCounter(400, JSON.stringify({ error: { message: "tools.3.custom.input_schema: JSON schema is invalid" } })))).rejects.toThrow(/JSON schema is invalid/);
  });

  it("prints the largest first, each server's reason when it was not counted, and the 100,000 line only when the total crosses it", () => {
    const base = { message: 8, toolUse: 286 };
    const small = costLines([{ name: "fs", tools: 14, tokens: 2829 }, { name: "big", tools: 30, tokens: 14698 }, { name: "local-one", tools: 0, tokens: null, why: "a local server; add --local to start it and count it" }], base);
    expect(small[1]).toMatch(/^big /);
    expect(small[2]).toMatch(/^fs /);
    expect(small.join("\n")).toContain("local-one  a local server; add --local");
    expect(small.join("\n")).toContain("All 2 together: 17,527 tokens");
    expect(small.join("\n")).not.toContain("over 100,000");
    const large = costLines([{ name: "hostinger", tools: 423, tokens: 123_813 }], base);
    expect(large.join("\n")).toContain("every Haiku 5.5 request pays its higher price for the whole prompt");
    expect(large.join("\n")).toContain("Haiku 5.5 $0.06");
  });
});

// the privacy page lives in the site, which the public copy of this package does not carry; there the check is skipped
const ROOT = join(__dirname, "..", "..", "..");
const PRIVACY = join(ROOT, "apps/web/app/legal/privacy/page.tsx");

describe("what smallprint cost sends is written where people read it", () => {
  it.skipIf(!existsSync(PRIVACY))("the privacy page and the README both name the command, the key and that nothing goes to smallprint.dev", () => {
    const privacy = readFileSync(PRIVACY, "utf8");
    const readme = readFileSync(join(__dirname, "..", "README.md"), "utf8");
    for (const page of [privacy, readme]) {
      expect(page).toContain("smallprint cost");
      expect(page).toContain("ANTHROPIC_API_KEY");
      expect(page).toMatch(/nothing (goes )?to smallprint\.dev/);
    }
  });
});
