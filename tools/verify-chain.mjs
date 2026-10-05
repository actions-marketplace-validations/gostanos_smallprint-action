// Recompute Small Print's record chain from the public API: every link and every chain hash, the entries hash of
// every day whose lines are kept, and the newest row's Ed25519 signature. A day whose lines were not kept is printed
// as "n/a", never as a pass. Exit 0 only when everything that can be checked passed.
// No dependencies beyond Node 18+. Usage: node verify-chain.mjs [https://smallprint.dev]
// Method, as the API prints it: entries_hash = sha256 of the lines "canonical_name<TAB>version<TAB>content_hash<LF>"
// sorted by name then version, as UTF-8 bytes; chain_hash = sha256 of prev_hash + LF + day + LF + through_at + LF +
// entries_hash; the first prev_hash is 64 zeros; signature = Ed25519 over the UTF-8 bytes of chain_hash, base64.
import { createHash, createPublicKey, verify } from "node:crypto";

const base = (process.argv[2] ?? "https://smallprint.dev").replace(/\/$/, "");
const ua = { headers: { "user-agent": "smallprint-verify-chain/2 (+https://smallprint.dev)" } };
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// the day address allows one reader 60 requests in ten minutes; past that it answers 429 and this waits, so a long
// chain is checked slowly, never partly
async function get(path) {
  for (;;) {
    const res = await fetch(`${base}${path}`, ua);
    if (res.status !== 429) return res;
    console.log(`      ${path}: the site asked for a pause (429); waiting one minute`);
    await sleep(60_000);
  }
}
const bytes = (a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));

const chain = await (await get("/api/chain")).json();
const rows = [...chain.rows].sort((a, b) => (a.day < b.day ? -1 : 1));
let ok = true;
const say = (good, text) => { ok = ok && good; console.log(`${good ? "ok  " : "FAIL"} ${text}`); };

let prev = "0".repeat(64);
for (const r of rows) {
  say(r.prevHash === prev, `${r.day}: prev_hash links to the day before`);
  say(sha256(`${r.prevHash}\n${r.day}\n${r.throughAt}\n${r.entriesHash}`) === r.chainHash, `${r.day}: chain_hash recomputes`);
  prev = r.chainHash;
}

let checked = 0;
const notKept = [];
for (const r of rows) {
  const res = await get(`/api/chain/${r.day}`);
  if (!res.ok) { say(false, `${r.day}: the lines could not be read (HTTP ${res.status})`); continue; }
  const day = await res.json();
  // a row that covers versions and comes back with no lines was written before lines were kept: nothing to recompute
  if (day.row?.linesKept === false || (r.versions > 0 && day.lines.length === 0)) {
    notKept.push(r.day);
    console.log(`n/a  ${r.day}: the ${r.versions} lines this row hashed were not kept, so its entries_hash cannot be recomputed`);
    continue;
  }
  const lines = [...day.lines].sort((a, b) => bytes(a.canonicalName, b.canonicalName) || bytes(a.version, b.version));
  const entries = sha256(lines.map((l) => `${l.canonicalName}\t${l.version}\t${l.contentHash}\n`).join(""));
  say(entries === r.entriesHash && lines.length === r.versions, `${r.day}: entries_hash recomputes from ${lines.length} lines`);
  checked++;
}

const last = rows[rows.length - 1];
try {
  const pem = await (await get("/.well-known/smallprint-chain-key.pub")).text();
  const key = createPublicKey(pem);
  let signed = 0;
  for (const r of rows) {
    if (!r.signature) { console.log(`n/a  ${r.day}: the row carries no signature`); continue; }
    signed++;
    say(verify(null, Buffer.from(r.chainHash, "utf8"), key, Buffer.from(r.signature, "base64")), `${r.day}: Ed25519 signature verifies against the published key`);
  }
  if (!last.signature) say(false, `${last.day}: the newest row carries no signature`);
  else if (!signed) say(false, "no row carries a signature");
} catch (e) {
  say(false, `signature check could not run: ${e.message}`);
}

console.log("");
if (ok) {
  console.log(`Every check that could be made passed: ${rows.length} rows link, ${rows[0].day} to ${last.day}; ${checked} of them had their entries_hash recomputed from kept lines.`);
  if (notKept.length) console.log(`${notKept.length} of the rows were written before lines were kept (${notKept.join(", ")}): their chain hashes link, and their entries hashes cannot be recomputed by anyone.`);
} else {
  console.log("Something did not recompute; see FAIL above.");
}
process.exit(ok ? 0 : 1);
