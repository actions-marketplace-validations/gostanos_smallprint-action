// Logs every fetch, socket, name lookup and started process to ./trap.log. Run the command under it to see for yourself
// that `check --no-upload` makes none: node --import ./no-upload-trap.mjs package/dist/smallprint.js check --no-upload

import net from "node:net"; import dns from "node:dns"; import cp from "node:child_process"; import { syncBuiltinESMExports } from "node:module"; import fs from "node:fs";
const log = (m) => fs.appendFileSync("trap.log", m + "\n");
const of = globalThis.fetch; globalThis.fetch = (u, ...r) => { log("FETCH " + String(u)); return of(u, ...r); };
const oc = net.Socket.prototype.connect; net.Socket.prototype.connect = function (...a) { log("SOCKET " + JSON.stringify(a[0]).slice(0, 120)); return oc.apply(this, a); };
const ol = dns.lookup; dns.lookup = (h, ...r) => { log("DNS " + h); return ol(h, ...r); };
for (const k of ["spawn", "execFile", "execFileSync", "spawnSync", "exec", "execSync"]) { const o = cp[k]; cp[k] = (c, a, ...r) => { log("PROC " + k + " " + c + " " + (Array.isArray(a) ? a.join(" ") : "").slice(0, 100)); return o(c, a, ...r); }; }
syncBuiltinESMExports();
