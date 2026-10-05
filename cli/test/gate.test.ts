import { describe, expect, it } from "vitest";
import { advisoriesForVersion, advisoryWords } from "../src/gate";

// the two advisories the tools audit of 29 Sep 2026 saw fail the gate on a fixed version of the filesystem server
const FS = [
  { id: "GHSA-hc55-p739-j48w", severity: "high", versionRange: "<=0.6.2 || >=2025.1.14 <2025.7.1" },
  { id: "GHSA-q66q-fx2p-7w4m", severity: "high", versionRange: "<=0.6.2 || >=2025.1.14 <2025.7.1" },
];

describe("gate reads each advisory's range (tools audit fix 1)", () => {
  it("does not count an advisory whose range leaves out the installed version", () => {
    const v = advisoriesForVersion(FS, "2026.7.10");
    expect(v.applies).toEqual([]);
    expect(v.notCovering.map((a) => a.id)).toEqual(FS.map((a) => a.id));
    expect(v.rangeUnknown).toEqual([]);
    expect(advisoryWords(v, "2026.7.10").join(" ")).toContain("do not cover 2026.7.10");
  });

  it("counts an advisory whose range covers the installed version", () => {
    const v = advisoriesForVersion(FS, "2025.3.0");
    expect(v.applies).toHaveLength(2);
  });

  it("says range unknown when the range cannot be read or the version is not known, and never counts it as covering", () => {
    const v = advisoriesForVersion([{ id: "A", severity: "critical", versionRange: null }, { id: "B", severity: "high", versionRange: "garbage" }, { id: "C", severity: "medium", versionRange: "*" }], "1.0.0");
    expect(v.applies).toEqual([]);
    expect(v.rangeUnknown.map((a) => a.id)).toEqual(["A", "B"]);
    const unknownVersion = advisoriesForVersion(FS, null);
    expect(unknownVersion.applies).toEqual([]);
    expect(unknownVersion.rangeUnknown).toHaveLength(2);
    expect(advisoryWords(unknownVersion, null).join(" ")).toContain("range unknown because the version here is not known");
  });
});

