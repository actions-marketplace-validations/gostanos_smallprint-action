/**
 * Whether a release changed the small print (decision 523). A release whose fingerprint moved with no change written
 * down, or that holds only a note such as an added install script, has no change on record; until 16 Oct 2026 the tools
 * here called every release that was not identical "changed", and changed_since_approval answered CHANGED for it. The
 * list of fields that are not a change to the text is packages/normalize's NOT_TEXT_CHANGE_FIELDS, copied here because
 * this package depends on nothing of the monorepo; packages/normalize/test/mcp-release-parity.test.ts fails if they differ.
 */
export const NOT_TEXT_CHANGE_FIELDS = ["version.bump", "source.presence", "install.script"] as const;

const NOT_TEXT = new Set<string>(NOT_TEXT_CHANGE_FIELDS);

export const changesSmallPrint = (r: { changes: readonly { field: string }[] }): boolean => r.changes.some((c) => !NOT_TEXT.has(c.field));

/**
 * The changes of a release that are to the small print, so a worst grade is taken over them alone: an install script
 * graded high made a release with one medium description change read "worst high" (pass 3 audit of 16 Oct 2026).
 */
export const textChanges = <C extends { field: string }>(r: { changes: readonly C[] }): C[] => r.changes.filter((c) => !NOT_TEXT.has(c.field));
