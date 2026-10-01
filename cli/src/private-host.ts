/**
 * Addresses that name this machine or a private network (tools audit of 29 Sep 2026, fix 6). `check --live` looked every
 * hosted server up on the record by its host, so `127.0.0.1:8765` or `mcp.corp.internal` left the machine, and the
 * check and sync payloads carried the same host. The record can never hold a private address, so asking about one
 * tells smallprint.dev something about the network and gets nothing back. A private host is never sent: the live check
 * skips its lookup, and uploads carry no host for it.
 */
import type { UploadItem } from "./parse";

const PRIVATE_SUFFIX = /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|corp|private|home\.arpa)$/i;

/** The host part of "host", "host:port", "[v6]" or "[v6]:port", lower case. */
export function hostOnly(hostPort: string): string {
  const h = hostPort.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]") > 0 ? h.indexOf("]") : undefined);
  const colons = h.split(":").length - 1;
  return colons === 1 ? h.slice(0, h.indexOf(":")) : h;
}

export function isPrivateHost(hostPort: string | null | undefined): boolean {
  if (!hostPort) return false;
  const h = hostOnly(hostPort).replace(/\.$/, "");
  if (!h) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (h.includes(":")) {
    // IPv6: loopback, unspecified, unique local (fc00::/7), link local (fe80::/10), and IPv4-mapped private addresses
    if (h === "::1" || h === "::") return true;
    if (/^f[cd][0-9a-f]{0,2}:/.test(h) || /^fe[89ab][0-9a-f]?:/.test(h)) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    return mapped ? isPrivateHost(mapped[1]!) : false;
  }
  // a single label (no dot) only resolves inside a local network or search domain
  if (!h.includes(".")) return true;
  return PRIVATE_SUFFIX.test(h);
}

/** The upload with every private host left out; the lock, which stays on the machine, keeps them. */
export function withoutPrivateHosts(items: readonly UploadItem[]): UploadItem[] {
  return items.map((i) => (i.remoteHost && isPrivateHost(i.remoteHost) ? { ...i, remoteHost: null } : i));
}
