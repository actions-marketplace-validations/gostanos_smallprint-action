/**
 * The Claude Code plugin's skills may run only the command each one shows (security audit of 29 Sep 2026, item 44): the
 * rule was `Bash(npx -y smallprint@X:*)`, which let the agent run `check --upload` or `sync --yes` with no one asked.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skill = (name: string) => readFileSync(new URL(`../../plugin/skills/${name}/SKILL.md`, import.meta.url), "utf8");

describe("plugin skill permissions", () => {
  for (const name of ["check", "locked", "gate"]) {
    it(`${name}: allows only the prefix of the one command it runs, and never an upload or a sync`, () => {
      const text = skill(name);
      const rule = /^allowed-tools: Bash\((.+):\*\)$/m.exec(text)?.[1];
      const command = /```!\n(.+)\n```/.exec(text)?.[1];
      expect(rule).toBeTruthy();
      expect(command).toBeTruthy();
      expect(command!.startsWith(rule!)).toBe(true);
      expect(rule).toMatch(/^npx -y smallprint@\d+\.\d+\.\d+ (check|gate)\b/);
      expect(rule).not.toMatch(/--upload|sync|--yes/);
      if (name !== "gate") expect(rule).toContain("--no-upload");
    });
  }
});
