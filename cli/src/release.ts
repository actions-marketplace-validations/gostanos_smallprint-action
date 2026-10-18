/**
 * Whether a release changed the small print (decision 523). A release whose fingerprint moved with no change written
 * down, or that holds only a note such as an added install script, has no change on record; until 16 Oct 2026 the gate
 * called every release that was not identical, and any fingerprint difference, a change, and exited 2 for it. The list
 * of fields that are not a change to the text is packages/normalize's NOT_TEXT_CHANGE_FIELDS, copied here because this
 * package depends on nothing of the monorepo; packages/normalize/test/cli-release-parity.test.ts fails if they differ.
 */
export const NOT_TEXT_CHANGE_FIELDS = ["version.bump", "source.presence", "install.script"] as const;

const NOT_TEXT = new Set<string>(NOT_TEXT_CHANGE_FIELDS);

/** A release from an answer with no `changes` list holds no change on record. */
export const changesSmallPrint = (r: { changes?: readonly { field: string }[] }): boolean => (r.changes ?? []).some((c) => !NOT_TEXT.has(c.field));

/**
 * The changes of a release that are to the small print, so a worst grade is taken over them alone: an install script
 * graded high made a release with one medium description change read "worst high" (pass 3 audit of 16 Oct 2026).
 */
export const textChanges = <C extends { field: string }>(r: { changes?: readonly C[] }): C[] => (r.changes ?? []).filter((c) => !NOT_TEXT.has(c.field));

const RANK = ["info", "low", "medium", "high", "critical"];

/**
 * The grade a release is shown with, as the entry page shows it: the worst of its changes to the small print when it holds
 * one, otherwise its own `worst` (a release that only added an install script keeps that note's grade). `show` printed
 * `worst`, which counts the install script, so a medium description change beside a high script read "high" there and
 * "medium" on the page (pass 5 audit of 16 Oct 2026).
 */
export const releaseGrade = (r: { worst?: string | null; changes?: readonly { field: string; severity?: string }[] }): string | null =>
  changesSmallPrint(r) ? textChanges(r).reduce<string>((w, c) => (c.severity && RANK.indexOf(c.severity) > RANK.indexOf(w) ? c.severity : w), "info") : (r.worst ?? null);
