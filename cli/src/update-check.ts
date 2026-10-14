/**
 * `smallprint version --check`: one GET to npm's registry for the newest published version, and one line that compares
 * it with the version running. Opt in only: plain `--version` asks nothing. The request carries the command's user agent
 * and nothing else; no inventory, no token, no path. A failure is said in a line and is never an error exit.
 */
export const LATEST_URL = "https://registry.npmjs.org/smallprint/latest";
export const CHANGELOG_URL = "https://smallprint.dev/changelog";
const CHECK_TIMEOUT_MS = 5_000;

/** -1, 0 or 1 for two x.y.z versions; a pre-release or build suffix is ignored. NaN when either does not parse. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim())?.slice(1).map(Number);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return Number.NaN;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return 0;
}

/** The line `version --check` prints for the installed version, asking npm with the given fetch. */
export async function versionCheckLine(installed: string, fetcher: typeof fetch = fetch, timeoutMs = CHECK_TIMEOUT_MS): Promise<string> {
  let res: Response;
  try {
    res = await fetcher(LATEST_URL, { headers: { accept: "application/json", "user-agent": `smallprint-cli/${installed}` }, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return `The check could not reach npm, so nothing was compared. smallprint ${installed} is installed.`;
  }
  let latest: unknown = null;
  try {
    if (res.ok) latest = ((await res.json()) as { version?: unknown }).version;
  } catch {
    latest = null;
  }
  if (typeof latest !== "string" || Number.isNaN(compareVersions(latest, latest))) {
    return `The check could not read a version from npm's answer, so nothing was compared. smallprint ${installed} is installed.`;
  }
  // a build newer than the one published (a release on its way out) is the newest there is
  const order = compareVersions(installed, latest);
  if (order >= 0 || latest === installed) return `smallprint ${installed} is the newest version.`;
  return `smallprint ${installed} is installed; ${latest} is published. Changes: ${CHANGELOG_URL}`;
}
