/**
 * The machine's salt (security audit of 29 Sep 2026, item 36; tools audit fix 8): 32 random bytes, written once to
 * ~/.config/smallprint/salt with mode 600 and never sent. sync keys every path hash, project scope and MCP env value
 * hash with it, so smallprint.dev holds hashes it cannot turn back into a user name, a folder or a secret by guessing;
 * the record only needs them to stay the same from one sync to the next on the same machine. Deleting the file makes
 * the next sync read every file as new, which is the only cost. The level-four reporter gets its own root-owned copy.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const SALT_SHAPE = /^[0-9a-f]{64}$/;

export function saltFile(configBase = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")): string {
  return join(configBase, "smallprint", "salt");
}

/** The salt on file, or a new one written there when `create` is set; undefined when there is none and none could be made. */
export function machineSalt(create: boolean, path = saltFile()): string | undefined {
  try {
    if (existsSync(path)) {
      const s = readFileSync(path, "utf8").trim();
      if (SALT_SHAPE.test(s)) return s;
    }
  } catch {
    /* unreadable: treated as missing */
  }
  if (!create) return undefined;
  try {
    const s = randomBytes(32).toString("hex");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, s + "\n", { mode: 0o600, flag: "wx" });
    chmodSync(path, 0o600);
    return s;
  } catch {
    // another run wrote it first, or the home is read-only: use what is there, else send unkeyed as before
    try {
      const s = readFileSync(path, "utf8").trim();
      return SALT_SHAPE.test(s) ? s : undefined;
    } catch {
      return undefined;
    }
  }
}
