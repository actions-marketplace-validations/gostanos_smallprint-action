// Preloaded with --import in tests: every fetch the command makes is written to $NETLOG, one URL a line, and answered
// with a 404 without touching the network. The tools audit of 29 Sep 2026 used the same kind of hook.
import { appendFileSync } from "node:fs";

globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  appendFileSync(process.env.NETLOG, url + "\n");
  return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
};
