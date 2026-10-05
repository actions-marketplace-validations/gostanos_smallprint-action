import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/main";

// the server said 0.2.2 in package 0.2.5 once, and its user agent said 0.1 for as long as it existed (consistency audit
// of 4 Oct 2026, row 25): one constant now, held to the package and to the registry file
describe("the version the server reports", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

  it("is the version in package.json and in server.json", () => {
    const pkg = JSON.parse(read("../package.json")) as { version: string };
    const server = JSON.parse(read("../server.json")) as { version: string; packages: { version: string }[] };
    expect(VERSION).toBe(pkg.version);
    expect(server.version).toBe(pkg.version);
    expect(server.packages.map((p) => p.version)).toEqual([pkg.version]);
  });

  it("is the only version written in the source: the server's name and its user agent both read the constant", () => {
    const main = read("../src/main.ts");
    expect(main).toContain("new McpServer({ name: \"smallprint\", version: VERSION }");
    expect(main).toContain("const UA = `smallprint-mcp/${VERSION} (+https://smallprint.dev)`;");
    expect(main.match(/smallprint-mcp\/\d|version: "\d/g)).toBeNull();
  });
});
