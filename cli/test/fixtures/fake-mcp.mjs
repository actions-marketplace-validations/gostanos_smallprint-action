// A small stdio MCP server for the watch tests (decision 513). It writes every byte it receives to $FAKE_RECV and every
// byte it sends to $FAKE_SENT, so a test can hold both directions to what passed through the watcher. The nth tools/list
// answers with the nth list in $FAKE_TOOLS (a JSON array of tool lists; the last one repeats). "test/notify" makes it
// send notifications/tools/list_changed. tools/call answers with its arguments echoed back, which is what the secret test needs.
import { appendFileSync } from "node:fs";

const lists = JSON.parse(process.env.FAKE_TOOLS ?? "[[]]");
let listed = 0;
let buf = "";
const send = (m) => {
  const s = JSON.stringify(m) + "\n";
  if (process.env.FAKE_SENT) appendFileSync(process.env.FAKE_SENT, s);
  process.stdout.write(s);
};
process.stdin.on("data", (chunk) => {
  if (process.env.FAKE_RECV) appendFileSync(process.env.FAKE_RECV, chunk);
  buf += chunk.toString("utf8");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: true } }, serverInfo: { name: "fake", version: process.env.FAKE_VERSION ?? "1.0.0" } } });
    else if (m.method === "tools/list") { send({ jsonrpc: "2.0", id: m.id, result: { tools: lists[Math.min(listed, lists.length - 1)] } }); listed++; }
    else if (m.method === "tools/call") send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: `echo ${JSON.stringify(m.params?.arguments ?? {})}` }] } });
    else if (m.method === "test/notify") send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
    else if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, result: {} });
  }
});
process.stdin.on("end", () => process.stdout.end());
