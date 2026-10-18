/**
 * `check --html [path]`: the same check, written as one self-contained HTML page on this machine. It holds only what the
 * terminal already shows: the names, sources and versions found, what the record answered for each, the lock status,
 * and the instruction-file lines the check grades. Every piece of text that comes from a package, a record answer, a
 * file or a path is escaped before it goes in (a tool description is text anyone can publish). The page loads nothing:
 * no fonts, no scripts, no images, and a Content-Security-Policy that blocks any request it might still try to make.
 */
import { formatMatch, WHO_ADDED_IT, type LineMatch } from "./grade";
import { ALREADY_THERE, formatLineChange, shownAdded, SHOWN_MAX, visible, type AddedLine, type LineChange } from "./lines";
import { CLIENT_NAME } from "./instructions";
import type { Discovered, Host } from "./parse";
import { plural } from "./record";

/** Where the report goes when --html is given no path. */
export const HTML_FILE = "smallprint-report.html";

/** The grading page the footer names. The only address the page links to besides the record's own entry pages. */
export const HOW_WE_GRADE = "https://smallprint.dev/how-we-grade";

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Text as HTML: every character that could open a tag, an entity or an attribute is written out. */
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ENTITIES[c]!);

/** The agent apps by their own names; the ones the instruction kinds do not name are added here. */
const APP_NAME: Partial<Record<Host, string>> = { ...CLIENT_NAME, copilot: "GitHub Copilot CLI", openclaw: "OpenClaw", hermes: "Hermes", harnos: "harnOS", manual: "Other places" };
export const appName = (host: string): string => APP_NAME[host as Host] ?? host;

/** One answer of /api/check for one server or skill. */
export interface RecordResult {
  name: string;
  status: string;
  detail: string;
  url: string | null;
  host?: string;
  kind?: string;
  /** The newest release on record that changed the small print, with its worst change's grade (decision 511). */
  newest?: { version: string; severity: string; criterion: string; detectedAt: string };
}

export type LockState = { state: "matches" } | { state: "changed"; what: string } | { state: "not in lock" };

export interface ReportRow {
  host: string;
  kind: "mcp" | "agent-skill";
  name: string;
  /** "npm", "pypi", "hosted at mcp.example.com", "local command" or "skill". */
  source: string;
  where: "home" | "this project";
  version: string | null;
  /** The config file a server was read from, shortened to ~; skills have none. */
  config?: string;
  /** What the record answered; null when grades were looked up and the answer had no row for this one; absent when grades were not looked up. */
  record?: RecordResult | null;
  /** Absent when there is no lock. */
  lock?: LockState;
}

export interface ReportFile {
  /** Shortened to ~ as the terminal prints it. */
  path: string;
  status: "new" | "unchanged" | "changed" | "removed";
  since?: string;
  where?: string[];
  /** The lines the terminal shows under this file; absent when it shows none. */
  change?: LineChange;
}

export interface ReportData {
  version: string;
  readAt: Date;
  rows: ReportRow[];
  /** The record's answer for the whole list; null when grades were not looked up. */
  grades: { letter: string; headline: string; criterion: string } | null;
  /** Why there are no grades, in a sentence; used when grades is null. */
  noGrades?: string;
  /** True for --no-upload: nothing was sent at all. */
  noUpload: boolean;
  /** True when the list was sent to the record and no grades came back (no answer, or one the command could not read). */
  attempted?: boolean;
  lock: { path: string; written: string; scope: "machine" | "project"; gone: number } | null;
  /** A lock file that exists and could not be read. */
  lockProblem?: string;
  files: ReportFile[];
  fileErrors: string[];
  /** --no-instruction-text: the terminal printed no text from the files, so the page does not either. */
  linesHidden: boolean;
}

/** The name the record keeps for an item: printable ASCII only, at most 120 characters (apps/web/app/api/check/route.ts). */
const recordName = (name: string): string => name.replace(/[^\x20-\x7e]/g, "").slice(0, 120) || "(unnamed)";
const recordKey = (kind: string, host: string, name: string): string => `${kind}\0${host.slice(0, 32)}\0${recordName(name)}`;

/**
 * Each item's answer from the record, matched by kind, agent app and name in the order they were sent, so two servers
 * with one name in two config files each get their own. An item the answer does not cover (the record reads the first
 * 200) gets null.
 */
export function matchResults(items: readonly Pick<Discovered, "kind" | "host" | "name">[], results: readonly RecordResult[]): (RecordResult | null)[] {
  const queues = new Map<string, RecordResult[]>();
  const keyed = results.every((r) => typeof r.host === "string" && typeof r.kind === "string");
  if (!keyed) return items.map((it, i) => (results[i] && results[i]!.name === recordName(it.name) ? results[i]! : null));
  for (const r of results) {
    const k = recordKey(r.kind!, r.host!, r.name);
    queues.set(k, [...(queues.get(k) ?? []), r]);
  }
  return items.map((it) => queues.get(recordKey(it.kind, it.host, it.name))?.shift() ?? null);
}

/** The rows of the report, one per server or skill found, in the order the terminal lists them. */
export function rowsOf(items: readonly Discovered[], opts: { underProject: (path: string) => boolean; tilde: (path: string) => string; results?: readonly (RecordResult | null)[]; lock?: readonly LockState[] }): ReportRow[] {
  return items.map((it, i) => {
    const record = opts.results ? { record: opts.results[i] ?? null } : {};
    const lock = opts.lock ? { lock: opts.lock[i]! } : {};
    if (it.kind === "mcp") {
      const source = it.canonicalName ? it.canonicalName.split(":")[0]! : it.remoteHost ? `hosted at ${it.remoteHost}` : "local command";
      return { host: it.host, kind: "mcp", name: it.name, source, where: opts.underProject(it.configPath) ? "this project" : "home", version: it.version, config: opts.tilde(it.configPath), ...record, ...lock };
    }
    return { host: it.host, kind: "agent-skill", name: it.displayName ?? it.name, source: "skill", where: opts.underProject(it.path) ? "this project" : "home", version: null, ...record, ...lock };
  });
}

/**
 * The words for the record's "clean" status, the check page's own: the status covers an entry with advisories that name
 * other versions, so "no advisory" stood beside a line naming two (pass 5 audit of 16 Oct 2026). The terminal's column,
 * the pill and the summary all print these.
 */
export const NO_COVERING_ADVISORY = "no advisory on record covers this version";

/** The record's status words, as the pill shows them, and the pill's colour. "clean" is never shown as safe (decision 210). */
const STATUS: Record<string, { words: string; tone: string }> = {
  critical: { words: "critical", tone: "high" },
  high: { words: "high", tone: "high" },
  watch: { words: "watch", tone: "medium" },
  clean: { words: NO_COVERING_ADVISORY, tone: "ok" },
  unlisted: { words: "not in catalog", tone: "none" },
  remote: { words: "hosted", tone: "low" },
  local: { words: "local", tone: "low" },
};

const pill = (tone: string, words: string): string => `<span class="pill ${tone}">${esc(words)}</span>`;

function when(d: Date): string {
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day}, ${time}`;
}

/** Only an https address is ever made a link; anything else stays text. */
const link = (url: string | null | undefined, text: string): string => (url && /^https:\/\/[^\s"'<>]+$/.test(url) ? `<a href="${esc(url)}" rel="noopener noreferrer">${text}</a>` : text);

function counts(rows: readonly ReportRow[]) {
  const c = { severe: 0, watch: 0, clean: 0, unlisted: 0, other: 0, missing: 0, lockChanged: 0, lockNew: 0 };
  for (const r of rows) {
    const s = r.record?.status;
    if (r.record === null) c.missing++;
    else if (s === "critical" || s === "high") c.severe++;
    else if (s === "watch") c.watch++;
    else if (s === "clean") c.clean++;
    else if (s === "unlisted") c.unlisted++;
    else if (s !== undefined) c.other++;
    if (r.lock?.state === "changed") c.lockChanged++;
    if (r.lock?.state === "not in lock") c.lockNew++;
  }
  return c;
}

/** The graded lines across every file the page shows lines for. */
function linesToRead(files: readonly ReportFile[]): { n: number; high: boolean } {
  let n = 0;
  let high = false;
  for (const f of files) {
    const lines = f.change?.kind === "diff" ? f.change.added : f.change?.kind === "first" ? f.change.existing : [];
    for (const l of lines) {
      if (!l.grades.length) continue;
      n++;
      if (l.grades.some((g) => g.severity === "high")) high = true;
    }
  }
  return { n, high };
}

function tile(n: number, label: string, tone = ""): string {
  return `<div class="tile${n > 0 && tone ? ` ${tone}` : ""}" role="listitem"><div class="n">${n.toLocaleString("en-US")}</div><div class="l">${esc(label)}</div></div>`;
}

function summary(d: ReportData): string {
  const c = counts(d.rows);
  const apps = new Set(d.rows.map((r) => r.host)).size;
  const tiles: string[] = [tile(d.rows.length, d.rows.length === 1 ? "server or skill found" : "servers and skills found")];
  if (d.grades) {
    const newestHigh = d.rows.filter((r) => r.record?.newest && (r.record.newest.severity === "high" || r.record.newest.severity === "critical")).length;
    if (d.rows.some((r) => r.record?.newest)) tiles.push(tile(newestHigh, "graded high in their newest change", "hi"));
    tiles.push(tile(c.severe, "with a high or critical advisory on record", "hi"));
    tiles.push(tile(c.watch, "marked watch by the record", "med"));
  } else tiles.push(tile(apps, apps === 1 ? "agent app with something installed" : "agent apps with something installed"));
  if (d.lock) {
    tiles.push(tile(c.lockChanged, "changed since your lock", "hi"));
    tiles.push(tile(c.lockNew, "not in your lock", "med"));
  } else if (d.grades) tiles.push(tile(c.unlisted, "not in the catalog"));
  if (d.linesHidden) {
    const changed = d.files.filter((f) => f.status === "changed" || f.status === "removed").length;
    tiles.push(tile(changed, changed === 1 ? "instruction file changed since the last run" : "instruction files changed since the last run", "med"));
  } else {
    const l = linesToRead(d.files);
    tiles.push(tile(l.n, l.n === 1 ? "instruction file line to read" : "instruction file lines to read", l.high ? "hi" : "med"));
  }
  let out = `<div class="tiles" role="list" style="--cols:${tiles.length}">${tiles.join("")}</div>`;
  if (d.grades && d.rows.length) {
    const total = d.rows.length;
    const parts = [
      { n: c.severe, colour: "var(--red)", words: "high or critical" },
      { n: c.watch, colour: "var(--amber)", words: "watch" },
      { n: c.unlisted, colour: "var(--ink-3)", words: "not in the catalog" },
      { n: c.clean, colour: "var(--green)", words: NO_COVERING_ADVISORY },
      { n: c.other, colour: "var(--rule)", words: "hosted or local, not graded" },
      { n: c.missing, colour: "var(--rule-soft)", words: "not in the record's answer" },
    ].filter((p) => p.n > 0);
    const label = `What the record says of the ${total} found: ${parts.map((p) => `${p.n} ${p.words}`).join(", ")}`;
    out += `<div class="bar" role="img" aria-label="${esc(label)}">${parts.map((p) => `<span style="width:${((p.n / total) * 100).toFixed(2)}%;background:${p.colour}"></span>`).join("")}</div>`;
    out += `<div class="legend">${parts.map((p) => `<span><i style="background:${p.colour}"></i>${esc(p.words)} ${p.n}</span>`).join("")}</div>`;
  }
  return out;
}

function lockCell(l: LockState | undefined): string {
  if (!l) return "";
  if (l.state === "matches") return `<td><span class="lock same">matches</span></td>`;
  if (l.state === "changed") return `<td><span class="lock changed">changed</span><small class="what">${esc(l.what)}</small></td>`;
  return `<td><span class="lock new">not in lock</span></td>`;
}

const GRADE_TONE: Record<string, string> = { critical: "high", high: "high", medium: "medium", low: "low", info: "low" };

/**
 * The newest change and its grade, or a plain line when the record has no change for the entry. An entry the record does
 * not hold gets neither: it showed a green "no change" pill until the audit of 16 Oct 2026, and nothing was compared.
 */
function newestCells(r: RecordResult | null | undefined): string {
  if (!r || r.status === "unlisted") return `<td></td><td></td>`;
  const n = r.newest;
  if (!n) return `<td><span class="why">No change to its small print on record.</span></td><td>${pill("none", "none on record")}</td>`;
  return `<td><span class="why">${esc(n.version)} · ${esc(n.detectedAt.slice(0, 10))}: ${esc(n.criterion)}</span></td><td>${pill(GRADE_TONE[n.severity] ?? "none", n.severity)}</td>`;
}

function recordCells(r: RecordResult | null | undefined): string {
  if (r === undefined) return "";
  if (r === null) return `<td><span class="why">The record's answer did not include this one.</span></td><td>${pill("none", "not looked up")}</td>`;
  const s = Object.hasOwn(STATUS, r.status) ? STATUS[r.status]! : { words: r.status || "no status", tone: "none" };
  return `<td><span class="why">${esc(r.detail)}</span></td><td>${pill(s.tone, s.words)}</td>`;
}

function appSection(app: string, rows: readonly ReportRow[], graded: boolean, locked: boolean): string {
  const servers = rows.filter((r) => r.kind === "mcp").length;
  const skills = rows.length - servers;
  const what = [servers ? plural(servers, "server") : "", skills ? plural(skills, "skill") : ""].filter(Boolean).join(", ");
  const configs = [...new Set(rows.map((r) => r.config).filter((c): c is string => !!c))];
  const where = configs.length ? ` · ${configs.slice(0, 3).join(", ")}${configs.length > 3 ? ` and ${plural(configs.length - 3, "more file")}` : ""}` : "";
  const head = `<tr><th>Server or skill</th><th>Version</th>${graded ? "<th>Newest change</th><th>Grade</th><th>Advisories on record</th><th>Status</th>" : ""}${locked ? "<th>Your lock</th>" : ""}</tr>`;
  const body = rows
    .map((r) => {
      const name = link(r.record?.url, `<b>${esc(r.name)}</b>`);
      // a skill and a hosted server have no version of their own; a package with none in its config is "not stated"
      const version = r.version ? esc(r.version) : r.kind === "mcp" && !r.source.startsWith("hosted at") ? "not stated" : "n/a";
      return `<tr><td class="name">${name}<small>${esc(r.source)} · ${esc(r.where)}</small></td><td class="num">${version}</td>${graded ? newestCells(r.record) : ""}${recordCells(r.record)}${locked ? lockCell(r.lock) : ""}</tr>`;
    })
    .join("\n");
  return `<section>
<div class="sec-head"><h2>${esc(app)}</h2><span class="count">${esc(what + where)}</span></div>
<div class="table-wrap"><table>
<thead>${head}</thead>
<tbody>
${body}
</tbody>
</table></div>
</section>`;
}

function ruleNote(grades: readonly LineMatch[], who: string): string {
  const order = { high: 0, medium: 1 };
  const sorted = [...grades].sort((x, y) => order[x.severity] - order[y.severity]);
  return `<div class="rule-note">${sorted.map((g) => esc(formatMatch(g))).join("<br>")}<br>${esc(who)}</div>`;
}

function lineRows(lines: readonly AddedLine[], who: string): string {
  return lines.map((l) => `<div class="line${l.grades.length ? " flag" : ""}"><span class="ln">${l.n}</span><span class="tx">${esc(visible(l.text))}</span></div>${l.grades.length ? ruleNote(l.grades, who) : ""}`).join("\n");
}

function fileBody(f: ReportFile): string {
  const c = f.change!;
  const label = `Lines in ${f.path}`;
  if (c.kind === "over") return `<div class="lines" role="group" aria-label="${esc(label)}"><div class="lines-head">${esc(formatLineChange(c, "").join(" "))}</div></div>`;
  if (c.kind === "first") {
    const shown = c.existing.slice(0, SHOWN_MAX);
    const rest = c.existing.length - shown.length;
    const head = formatLineChange(c, "")[0]!;
    return `<div class="lines" role="group" aria-label="${esc(label)}"><div class="lines-head">${esc(head)}</div>
${lineRows(shown, ALREADY_THERE)}${rest > 0 ? `<div class="lines-head">${esc(`${plural(rest, "more such line is", "more such lines are")} not shown here. Read the file to see them.`)}</div>` : ""}</div>`;
  }
  const shown = shownAdded(c.added);
  const rest = c.added.length - shown.length;
  const head = formatLineChange(c, "")[0]!;
  return `<div class="lines" role="group" aria-label="${esc(label)}"><div class="lines-head">${esc(head)}</div>
${lineRows(shown, WHO_ADDED_IT)}${rest > 0 ? `<div class="lines-head">${esc(`${plural(rest, "more added line is", "more added lines are")} not shown here. Read the file to see them.`)}</div>` : ""}</div>`;
}

function fileRow(f: ReportFile): string {
  const day = (s?: string) => (s ? s.slice(0, 10) : "");
  const where = f.where ? `, in: ${f.where.length ? f.where.join(", ") : "formatting only"}` : "";
  let tag: string;
  let note: string;
  if (f.status === "changed") { tag = pill("medium", "changed"); note = `changed since the last run${where}`; }
  else if (f.status === "removed") { tag = pill("medium", "removed"); note = `gone since the last run, recorded since ${day(f.since)}`; }
  else if (f.status === "new") { tag = pill("none", "first seen"); note = f.change ? "first look" : "recorded on this run"; }
  else { tag = pill("ok", "unchanged"); note = `since ${day(f.since)}`; }
  const graded = f.change && f.change.kind !== "over" ? (f.change.kind === "diff" ? f.change.added : f.change.existing).filter((l) => l.grades.length) : [];
  if (graded.length) tag = pill(graded.some((l) => l.grades.some((g) => g.severity === "high")) ? "high" : "medium", graded.length === 1 ? "1 line to read" : `${graded.length} lines to read`);
  const head = `<span class="path">${esc(f.path)}</span>${tag}<span class="arr">${esc(note)}</span>`;
  if (!f.change) return `<div class="frow">${head}</div>`;
  return `<details open><summary>${head}</summary>\n${fileBody(f)}\n</details>`;
}

function filesSection(d: ReportData): string {
  const rank = (f: ReportFile) => (f.change ? 0 : f.status === "changed" || f.status === "removed" ? 1 : f.status === "new" ? 2 : 3);
  const files = [...d.files].sort((a, b) => rank(a) - rank(b));
  const count = `${plural(d.files.length, "file")} · compared with the last run on this machine, never sent`;
  const hidden = d.linesHidden ? `<p class="fine">No text from these files is shown, because the check ran with --no-instruction-text.</p>` : "";
  const errors = d.fileErrors.length ? `<p class="fine">${d.fileErrors.map((e) => `Could not read ${esc(e)}.`).join("<br>")}</p>` : "";
  const body = files.length ? files.map(fileRow).join("\n") : `<p class="fine">None found (CLAUDE.md, AGENTS.md, OpenClaw workspace, Cursor and Windsurf rules, Claude settings).</p>`;
  return `<section>
<div class="sec-head"><h2>Instruction files</h2><span class="count">${esc(count)}</span></div>
${hidden}${body}
${errors}
</section>`;
}

/** The lede: what this page is and what the check sent to make it. Kept to what the CLI page says leaves the machine. */
function lede(d: ReportData): string {
  const stayed = "Your configs, keys, paths and file contents stayed on this machine.";
  if (d.grades) return `The MCP servers and skills in the agent configs this check reads, looked up on the record${d.lock ? ", and compared with your lock file" : ""}. To look them up, the check sent server names, package identities, version numbers, the host each one belongs to, and fingerprints of each skill's files, the same as a plain check. ${stayed}`;
  const what = `The MCP servers and skills in the agent configs this check reads${d.lock ? ", compared with your lock file" : ""}.`;
  if (d.attempted) return `${what} To look them up, the check sent server names, package identities, version numbers, the host each one belongs to, and fingerprints of each skill's files, and no grades came back. ${stayed}`;
  return `${what} Nothing was sent, and your configs, keys, paths and file contents stayed on this machine.`;
}

function notices(d: ReportData): string {
  const out: string[] = [];
  if (d.grades) {
    // the record's criterion starts with its own letter ("D: ..."), and the page shows the letter once
    const { letter, criterion } = d.grades;
    const said = criterion.startsWith(`${letter}:`) ? criterion.slice(letter.length + 1).trimStart() : criterion;
    out.push(`<p class="grade">The record's grade for this list: <b>${esc(letter)}</b>. ${esc(said)}</p>`);
  }
  else out.push(`<p class="notice">${esc(d.noUpload ? "Grades were not looked up, because --no-upload sends nothing. This page shows what was found on this machine and, when there is a lock file, how it compares with it." : d.noGrades ?? "Grades were not looked up.")}</p>`);
  if (d.lock) out.push(`<p class="fine">${esc(`Compared with ${d.lock.path}, written ${d.lock.written.slice(0, 10)}, which covers ${d.lock.scope === "project" ? "this project only, so anything installed in your home folder shows as not in lock" : "this whole machine"}.${d.lock.gone ? ` ${plural(d.lock.gone, "entry in the lock is", "entries in the lock are")} not on this machine now.` : ""}`)}</p>`);
  else if (d.lockProblem) out.push(`<p class="fine">${esc(d.lockProblem)}</p>`);
  return out.join("\n");
}

const CSS = `:root{
  --paper:#F2F3F5;--paper-2:#FFFFFF;--rule:#CFD3D9;--rule-soft:#E1E4E9;
  --ink:#15181C;--ink-2:#3E434B;--ink-3:#5B616B;
  --red:#C8341E;--red-soft:#FBE9E5;--amber:#8A5410;--amber-soft:#F6EBD3;--green:#2E6B4E;--green-soft:#DDEBE1;
  --sans:system-ui,"Helvetica Neue",Arial,sans-serif;--mono:ui-monospace,"Courier New",monospace;--serif:"Libre Caslon Text",Georgia,serif;
  color-scheme:light;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--paper:#14171B;--paper-2:#1C2026;--rule:#31363E;--rule-soft:#252930;--ink:#E8EAED;--ink-2:#B3B8C0;--ink-3:#868D98;--red:#FF6A4F;--red-soft:#3A1A14;--amber:#E4A94A;--amber-soft:#3A2B10;--green:#7FCFA3;--green-soft:#163023;color-scheme:dark}}
:root[data-theme="dark"]{--paper:#14171B;--paper-2:#1C2026;--rule:#31363E;--rule-soft:#252930;--ink:#E8EAED;--ink-2:#B3B8C0;--ink-3:#868D98;--red:#FF6A4F;--red-soft:#3A1A14;--amber:#E4A94A;--amber-soft:#3A2B10;--green:#7FCFA3;--green-soft:#163023;color-scheme:dark}
*{box-sizing:border-box}
body{background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.55;margin:0}
a{color:inherit;text-decoration-color:var(--rule);text-underline-offset:2px}
a:hover{text-decoration-color:var(--ink)}
.wrap{max-width:1040px;margin:0 auto;padding-inline:20px;padding-block:28px 64px}
.mast{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;border-bottom:2px solid var(--ink);padding-bottom:12px}
.mark{font-family:var(--serif);font-weight:700;font-size:26px;color:var(--red);line-height:1}
.brand{font-weight:700;letter-spacing:.02em}
.brand em{font-style:normal;color:var(--red)}
.meta{margin-left:auto;font-size:13px;color:var(--ink-3);font-variant-numeric:tabular-nums}
h1{font-family:var(--serif);font-size:34px;line-height:1.15;margin:26px 0 6px;text-wrap:balance}
h2{font-family:var(--serif);font-size:21px;margin:0;text-wrap:balance}
.lede{color:var(--ink-2);max-width:66ch;margin:0 0 22px}
.notice{border-left:3px solid var(--amber);background:var(--amber-soft);padding:10px 14px;margin:0 0 18px;max-width:80ch}
.grade{margin:0 0 18px;max-width:80ch;color:var(--ink-2)}
.grade b{color:var(--ink);font-size:17px}
.fine{font-size:13px;color:var(--ink-3);margin:10px 0;max-width:90ch}
.tiles{display:grid;grid-template-columns:repeat(var(--cols,5),minmax(0,1fr));border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
.tile{padding:14px 14px 12px;border-left:1px solid var(--rule-soft)}
.tile:first-child{border-left:0;padding-left:0}
.tile .n{font-size:30px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1}
.tile .l{font-size:12.5px;color:var(--ink-3)}
.tile.hi .n{color:var(--red)} .tile.med .n{color:var(--amber)} .tile.ok .n{color:var(--green)}
.bar{display:flex;height:8px;border-radius:2px;overflow:hidden;margin:16px 0 4px;background:var(--rule-soft)}
.bar span{display:block}
.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--ink-3)}
.legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;vertical-align:0}
section{margin-top:34px}
.sec-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--ink);padding-bottom:8px}
.sec-head .count{font-size:13px;color:var(--ink-3);overflow-wrap:anywhere}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px;min-width:640px}
th{text-align:left;font-size:12px;font-weight:600;color:var(--ink-3);letter-spacing:.04em;text-transform:uppercase;padding:9px 10px 7px 0;border-bottom:1px solid var(--rule)}
td{padding:11px 10px 11px 0;border-bottom:1px solid var(--rule-soft);vertical-align:top}
td.name b{font-weight:600;overflow-wrap:anywhere}
td.name small,td small.what{display:block;color:var(--ink-3);font-size:12.5px;overflow-wrap:anywhere}
.num{font-variant-numeric:tabular-nums;white-space:nowrap}
.pill{display:inline-block;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap}
.pill.high{background:var(--red-soft);color:var(--red)} .pill.medium{background:var(--amber-soft);color:var(--amber)} .pill.low,.pill.none{background:var(--rule-soft);color:var(--ink-2)} .pill.ok{background:var(--green-soft);color:var(--green)}
.lock{font-size:13px;white-space:nowrap} .lock.same{color:var(--green)} .lock.changed{color:var(--red);font-weight:600} .lock.new{color:var(--amber)}
.why{color:var(--ink-2);font-size:13px;overflow-wrap:anywhere}
details,.frow{border-bottom:1px solid var(--rule-soft)}
summary,.frow{padding:12px 0;display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}
summary{cursor:pointer;list-style:none}
summary::-webkit-details-marker{display:none}
summary:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.path{font-weight:600;overflow-wrap:anywhere}
.arr{margin-left:auto;color:var(--ink-3);font-size:13px}
.lines{margin:0 0 14px;border:1px solid var(--rule);background:var(--paper-2);border-radius:4px;overflow-x:auto}
.lines-head{font-size:12.5px;color:var(--ink-2);padding:8px 12px;border-bottom:1px solid var(--rule-soft)}
.lines-head:last-child{border-bottom:0}
.line{display:grid;grid-template-columns:52px minmax(0,1fr);gap:0;font-family:var(--mono);font-size:13.5px;border-top:1px solid var(--rule-soft)}
.lines-head+.line{border-top:0}
.line .ln{color:var(--ink-3);text-align:right;padding:7px 10px 7px 0;border-right:1px solid var(--rule-soft)}
.line .tx{padding:7px 12px;white-space:pre-wrap;word-break:break-word}
.line.flag{background:var(--red-soft)}
.rule-note{font-family:var(--sans);font-size:12.5px;color:var(--ink-2);padding:0 12px 8px 62px;background:var(--red-soft)}
.foot{margin-top:40px;border-top:2px solid var(--ink);padding-top:12px;font-size:13px;color:var(--ink-3);display:flex;gap:18px;flex-wrap:wrap}
.foot code{font-family:var(--mono);color:var(--ink)}
@media (max-width:760px){.wrap{padding-inline:16px}.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.tile{border-left:0;padding-left:0;border-top:1px solid var(--rule-soft)}.meta{margin-left:0;width:100%}h1{font-size:28px}.rule-note{padding-left:12px}}`;

/** The whole page. Every value from outside the command goes through esc; numbers and the fixed words do not need to. */
export function renderReport(d: ReportData): string {
  const apps: string[] = [];
  for (const r of d.rows) if (!apps.includes(r.host)) apps.push(r.host);
  const sections = apps.map((h) => appSection(appName(h), d.rows.filter((r) => r.host === h), d.grades !== null, d.lock !== null)).join("\n");
  const none = d.rows.length ? "" : `<section><p class="fine">No MCP servers or skills were found in the config locations the check reads.</p></section>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>Small Print report</title>
<style>
${CSS}
</style>
</head>
<body>
<div class="wrap">
<header class="mast">
<span class="mark" aria-hidden="true">*</span><span class="brand">Small <em>Print</em></span>
<span class="meta">This machine · read ${esc(when(d.readAt))} · smallprint ${esc(d.version)}</span>
</header>
<h1>What your agents run on this machine</h1>
<p class="lede">${esc(lede(d))}</p>
${notices(d)}
${summary(d)}
${sections}${none}
${filesSection(d)}
<footer class="foot">
<span>Made on this machine by <code>npx smallprint check --html</code>. With <code>--no-upload</code> it sends nothing, and the page shows what was found and the lock column, with no grades.</span>
<span>Grades follow the written rules at ${link(HOW_WE_GRADE, "smallprint.dev/how-we-grade")}.</span>
</footer>
</div>
</body>
</html>
`;
}
