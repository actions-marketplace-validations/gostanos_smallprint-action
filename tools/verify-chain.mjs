// Recompute Small Print's record chain from the public API: every link and every chain hash, the entries hash of
// every day whose lines are kept, and the newest row's Ed25519 signature. A day whose lines were not kept is printed
// as "n/a", never as a pass. Exit 0 only when everything that can be checked passed.
// No dependencies beyond Node 18+. Usage: node verify-chain.mjs [https://smallprint.dev]
// Method, as the API prints it: entries_hash = sha256 of the lines "canonical_name<TAB>version<TAB>content_hash<LF>"
// sorted by name then version, as UTF-8 bytes; chain_hash = sha256 of prev_hash + LF + day + LF + through_at + LF +
// entries_hash; the first prev_hash is 64 zeros; signature = Ed25519 over the UTF-8 bytes of chain_hash, base64.
// One version instead of every row: node verify-chain.mjs [https://smallprint.dev] npm:@scope/name@1.2.3
// That fetches the version's receipt, the one day that kept its line, the row index and the key: four requests. It
// checks that the kept line is among the day's lines, that the day's entries_hash recomputes from them, that the row's
// chain_hash recomputes and links forward to the newest row, and that the row's signature verifies.
import { createHash, createPublicKey, verify } from "node:crypto";

const args = process.argv.slice(2);
const one = args.find((a) => /^[a-z0-9-]+:.+@[^@]+$/.test(a));
const base = (args.find((a) => a !== one) ?? "https://smallprint.dev").replace(/\/$/, "");
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
const lineOf = (l) => `${l.canonicalName}\t${l.version}\t${l.contentHash}\n`;
const entriesOf = (lines) => sha256([...lines].sort((a, b) => bytes(a.canonicalName, b.canonicalName) || bytes(a.version, b.version)).map(lineOf).join(""));
const chainHashOf = (r) => sha256(`${r.prevHash}\n${r.day}\n${r.throughAt}\n${r.entriesHash}`);

if (one) {
  // registry:name@version: the receipt names the row that kept the line, the day serves the lines, the index links it forward
  const at = one.lastIndexOf("@");
  const canonicalName = one.slice(0, at), version = one.slice(at + 1);
  const colon = canonicalName.indexOf(":");
  const path = `/api/receipt/${encodeURIComponent(canonicalName.slice(0, colon))}/${canonicalName.slice(colon + 1).split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(version)}`;
  const res = await get(path);
  if (!res.ok) { console.log(`FAIL ${canonicalName} ${version}: the receipt answered HTTP ${res.status}`); process.exit(1); }
  const receipt = await res.json();
  let ok = true;
  const say = (good, text) => { ok = ok && good; console.log(`${good ? "ok  " : "FAIL"} ${text}`); };
  if (!receipt.chain || !receipt.keptLine) {
    console.log(`n/a  ${canonicalName} ${version}: ${receipt.chainStateNote ?? "no signed row covers this version yet"}`);
    process.exit(2);
  }
  const want = { canonicalName: receipt.canonicalName, version: receipt.version, contentHash: receipt.contentHash };
  say(lineOf(want) === receipt.keptLine, `${version}: the kept line is "${canonicalName}<TAB>${version}<TAB>${receipt.contentHash}"`);
  const day = await (await get(`/api/chain/${receipt.chain.day}`)).json();
  say(day.lines.some((l) => lineOf(l) === receipt.keptLine), `${receipt.chain.day}: the line is among the ${day.lines.length} lines served with the row`);
  say(entriesOf(day.lines) === day.row.entriesHash && day.lines.length === day.row.versions, `${receipt.chain.day}: entries_hash recomputes from the lines`);
  say(chainHashOf(day.row) === day.row.chainHash && day.row.chainHash === receipt.chain.chainHash, `${receipt.chain.day}: chain_hash recomputes and is the one the receipt names`);
  const index = await (await get("/api/chain")).json();
  const rows = [...index.rows].sort((a, b) => (a.day < b.day ? -1 : 1));
  let prev = day.row.chainHash, linked = 0;
  for (const r of rows.filter((r) => r.day > day.row.day)) { if (r.prevHash !== prev || chainHashOf(r) !== r.chainHash) { linked = -1; break; } prev = r.chainHash; linked++; }
  say(linked >= 0, `${receipt.chain.day}: links forward through ${Math.max(linked, 0)} later row${linked === 1 ? "" : "s"} to the newest, ${rows[rows.length - 1].day}`);
  try {
    const key = createPublicKey(await (await get("/.well-known/smallprint-chain-key.pub")).text());
    if (day.row.signature) say(verify(null, Buffer.from(day.row.chainHash, "utf8"), key, Buffer.from(day.row.signature, "base64")), `${receipt.chain.day}: Ed25519 signature verifies against the published key`);
    else console.log(`n/a  ${receipt.chain.day}: the row carries no signature`);
  } catch (e) { say(false, `signature check could not run: ${e.message}`); }
  console.log("");
  console.log(ok ? `${canonicalName} ${version}: the record held this fingerprint on ${receipt.chain.day}, and the row that says so links to the newest row and verifies.` : "Something did not recompute; see FAIL above.");
  process.exit(ok ? 0 : 1);
}

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
