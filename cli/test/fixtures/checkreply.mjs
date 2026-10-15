// Preloaded with --import in the --html tests: every fetch the command makes is written to $NETLOG, one URL a line,
// and /api/check is answered with a fixed shape of the record's answer without touching the network. A server whose
// name holds "bad" is answered high, "meh" watch, a skill unlisted, anything else clean; the high one's detail carries
// a script tag, standing in for text anyone can publish.
import { appendFileSync } from "node:fs";

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (process.env.NETLOG) appendFileSync(process.env.NETLOG, url + "\n");
  if (url.endsWith("/api/check") && init && init.method === "POST") {
    const body = JSON.parse(String(init.body));
    const results = body.items.map((it) => {
      const status = it.name.includes("bad") ? "high" : it.name.includes("meh") ? "watch" : it.kind === "agent-skill" ? "unlisted" : "clean";
      const detail = status === "high" ? '1 advisory on record, worst high <script>alert("x")</script>' : `the record's words for ${it.name}`;
      return { name: it.name, host: it.host, kind: it.kind, canonicalName: it.canonicalName, version: it.version, status, detail, advisories: [], url: it.canonicalName ? `https://smallprint.dev/${it.canonicalName.replace(":", "/")}` : null,
        // the newest change on record (decision 511): "bad" ones changed high, with text anyone can publish in the criterion slot
        ...(it.name.includes("bad") ? { newest: { version: "9.9.9", detectedAt: "2026-10-14T05:00:00Z", severity: "high", rule: "drift.tool.description.exfiltration", criterion: "names an address <img src=x>", field: "tool.description", subject: "t", changes: 1 } } : {}) };
    });
    return new Response(JSON.stringify({ id: null, grade: "D", headline: `${results.length} items checked`, criterion: "D: bad-srv is inside the range of a high advisory on record.", results, cardUrl: null }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
};
