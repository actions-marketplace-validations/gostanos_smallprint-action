// The legal and accuracy review of 15 Oct 2026 (decision 513): what watch and scan-chats print never claims more than
// they know, and a server's own text cannot act on the reader's terminal.
import { describe, expect, it } from "vitest";
import { formatWatchEntries, warningLine } from "../src/watch";
import { formatScan } from "../src/chatscan";

describe("watch and scan-chats wording", () => {
  it("prints a server's description with its control characters written out, never sent to the terminal", () => {
    const lines = formatWatchEntries([{ time: "2026-10-15T20:00:00Z", server: "npm:demo", tool: "search", change: "description", descriptionBefore: "Searches.", descriptionAfter: "Searches.\u001b[2K\u001b[1A hidden" }]);
    const text = lines.join("\n");
    expect(text).not.toContain("\u001b");
    expect(text).toContain("<U+001B>");
  });

  it("does not say a server changed when only the lock differs", () => {
    const line = warningLine("npm:demo@1.0.0", [{ tool: "(all tools)", change: "lock", version: "1.0.0" }]);
    expect(line).toContain("what npm:demo@1.0.0 serves differs from smallprint.lock");
    expect(line).not.toContain("changed what it tells your agent");
    expect(line).toContain("Nothing was stopped.");
  });

  it("never reads an empty scan as an all-clear, and never calls a match a real secret", () => {
    const empty = formatScan({ sources: [], filesRead: 3, unreadable: [], findings: [] }).join("\n");
    expect(empty).toContain("A secret in another form would not be found.");
    const some = formatScan({ sources: [], filesRead: 1, unreadable: [], findings: [{ file: "~/x.jsonl", line: 2, kind: "GitHub token", preview: "ghp_…" }] }).join("\n");
    expect(some).toContain("cannot tell which ones are real");
    expect(some).not.toMatch(/exposed|compromised|leaked|guarantee|safe/i);
  });
});
