/**
 * The grading rules, on this machine, for a line added to an instruction file (decision 470). A line that reaches
 * CLAUDE.md, AGENTS.md or a rules file is read by the agent as part of its system prompt, so the command grades each
 * added line with the rules the record grades published tool text with: moving data out, override, hidden text and
 * sensitive destination, with the negation, quotation and folding helpers they rely on. Nothing here is sent.
 *
 * The command has no runtime dependencies, so the block between the two marker lines is a copy of the record's own
 * rules, declaration for declaration, from packages/normalize/src/severity.ts in the Small Print repository. A test
 * there (packages/normalize/test/cli-grade-parity.test.ts) reads both files and fails the day a pattern or a helper
 * differs. Change the rules there first, then copy them here.
 */
// ---- copied from packages/normalize/src/severity.ts: begin ----
const MOVE_VERBS = "(?:send|sends|sent|include|includes|included|collect|collects|collected|copy|copies|copied|upload|uploads|uploaded|post|posts|posted|forward|forwards|forwarded|print|prints|printed|attach|attaches|attached|dump|dumps|dumped|extract|extracts|extracted|steal|steals|stolen|harvest|harvests|harvested|gather|gathers|gathered|transmit|transmits|transmitted|exfiltrate|exfiltrates|exfiltrated|leak|leaks|leaked|expose|exposes|exposed|log|logs|logged|reveal|reveals|revealed|embed|embeds|embedded)";
const SECRET_NOUNS = "(?:credentials?|passwords?|passphrases?|api[ _-]?keys?|access[ _-]?keys?|secret[ _-]?keys?|private[ _-]?keys?|ssh[ _-]?keys?|signing[ _-]?keys?|(?:api|access|auth|bearer|secret|session|oauth|refresh|github|npm|aws)[ _-]?tokens?|secrets?|\\.env\\b|~\\/\\.(?:aws|ssh|config|gnupg|kube|docker|npmrc|netrc)|id_rsa|id_ed25519|\\.pem\\b|keystore|seed phrases?|cookies?|session ids?)";
const SECRET_NEAR_VERB = new RegExp(`\\b${MOVE_VERBS}\\b[^.\\n]{0,80}?${SECRET_NOUNS}|${SECRET_NOUNS}[^.\\n]{0,60}?\\b(?:to|into|and)\\b[^.\\n]{0,40}?\\b${MOVE_VERBS}\\b|${SECRET_NOUNS}[^.\\n]{0,60}?\\b(?:is|are|was|were|get|gets|got|be|being|been)\\s+(?:then\\s+|also\\s+|silently\\s+|automatically\\s+)?${MOVE_VERBS}\\b`, "i");
export const EXFIL_PATTERNS: readonly RegExp[] = [
  // a move verb with a named address: a URL or a host
  /\b(?:send|sends|sent|post|posts|posted|upload|uploads|uploaded|forward|forwards|forwarded|transmit|transmits|transmitted|exfiltrate|exfiltrated|submit|submits|submitted|report|reports|reported|sync|syncs|synced)\b[^.\n]{0,80}?\bto\s+(?:https?:\/\/|[a-z0-9-]+(?:\.[a-z0-9-]+)+\b)/i,
  // a secret-bearing path or file with a verb that reads or moves it ("read ~/.aws/credentials and append", "encode id_rsa");
  // the bare path ("check that ~/.ssh/config lists the host") is the sensitive tier, decision 107
  /\b(?:read|reads|cat|open|opens|include|includes|copy|copies|send|sends|upload|uploads|post|posts|print|prints|dump|dumps|extract|extracts|collect|collects|attach|attaches|paste|pastes|encode|encodes|base64|exfiltrate|exfiltrates|append|appends)\b[^.\n]{0,60}?(?:~\/\.(?:aws|ssh|gnupg|kube|docker|npmrc|netrc)\b|\b(?:id_rsa|id_ed25519)\b)|(?:~\/\.(?:aws|ssh|gnupg|kube|docker|npmrc|netrc)\b|\b(?:id_rsa|id_ed25519)\b)[^.\n]{0,60}?\b(?:contents?|and (?:send|sends|include|includes|post|posts|upload|uploads|paste|pastes|append|appends))\b/i,
  // the environment dumped into the conversation ("run env and include the full output"), or secrets listed and pasted
  /\b(?:run|runs|print|prints|dump|dumps|cat|echo|output|paste|pastes)\b[^.\n]{0,30}?\benv\b(?![a-z])|\benvironment variables?\b[^.\n]{0,60}?\b(?:include|includes|paste|pastes|output|send|sends|share|shares|report|reports|print|prints)\b|\b(?:include|includes|paste|pastes|send|sends|share|shares|report|reports|print|prints)\b[^.\n]{0,60}?\benvironment variables?\b/i,
  /\b(?:get|gets|list|lists|dump|dumps|export|exports|fetch|fetches)\b[^.\n]{0,40}?\bsecrets?\b[^.\n]{0,80}?\b(?:paste|pastes|include|includes|send|sends|post|posts|upload|uploads|share|shares|output|print|prints)\b/i,
  // a secret next to a verb that moves it ("include the contents of .env in the reply", "read the token and post it")
  SECRET_NEAR_VERB,
  // the vocabulary of exfiltration itself
  /\bexfiltrat(?:e|es|ed|ing|ion)\b/i,
  /\battacker[- ]controlled\b/i,
  /\b(?:dns|icmp)\b[^.\n]{0,40}?\b(?:quer(?:y|ies)|tunnel(?:s|ing)?)\b[^.\n]{0,60}?\b(?:contents?|data|secrets?|keys?)\b|\bencode\b[^.\n]{0,60}?\b(?:into|in|as|over)\s+dns\b/i,
  /\bwebhook\.site\b/i,
];
export const OVERRIDE_PATTERNS: readonly RegExp[] = [
  /\bdo not (?:tell|mention|reveal|disclose|inform|show|alert)\b/i,
  /\bwithout (?:asking|telling|confirming|notifying|informing|the user)/i,
  /\bignore (?:all |any |the |your )?(?:previous|prior|above|earlier|system|other|safety) (?:instructions?|prompts?|rules?|guidelines?)\b/i,
  // "system prompt" only with a verb that acts on it: the bare phrase names a data field as often as an instruction
  // ("fetch a record (system prompt, knowledge, config)" sat on the home page graded high, 24 Sep 2026, decision 220)
  /\b(?:ignore|ignoring|disregard|override|overrid(?:e|ing)|overwrite|replace|forget|bypass|reveal|leak|disclose|print|show|dump|exfiltrate|extract)\b[^.\n]{0,40}\bsystem (?:prompt|instructions?)\b/i,
  /\bsystem (?:prompt|instructions?)\b[^.\n]{0,30}\b(?:is|are) (?:now|replaced|overridden|ignored|void)\b/i,
];
export const SENSITIVE_PATTERNS: readonly RegExp[] = [
  // a secret-bearing path named without a verb that reads or moves it: worth a look, not an alarm
  /~\/\.(?:aws|ssh|gnupg|kube|docker|npmrc|netrc)\b|\b(?:id_rsa|id_ed25519)\b/i,
  // a move verb with a generic destination noun
  /\b(?:send|sends|post|posts|upload|uploads|forward|forwards|transmit|transmits|submit|submits|report|reports|sync|syncs)\b[^.\n]{0,80}?\bto\s+(?:the |our |a )?(?:remote |external |analytics |telemetry |collection )?(?:server|endpoint|api|webhook|url|bucket)\b/i,
];
const HIDDEN_CHARS: readonly { re: RegExp; name: string }[] = [
  { re: /[\u200B\u200C\u200D\u2060\u2061\u2062\u2063\u2064\uFEFF]/g, name: "zero-width character" },
  { re: /[\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069]/g, name: "bidirectional control" },
  { re: /[\u00AD\u034F\u180E]/g, name: "invisible formatting character" },
];
const JOINING_SCRIPT = /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Mongolian}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}]/u;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const EMOJI_MODIFIER = /[\uFE0F\u{1F3FB}-\u{1F3FF}]/u;
function codePointBefore(text: string, i: number): string {
  if (i <= 0) return "";
  const lo = text.charCodeAt(i - 1);
  return lo >= 0xdc00 && lo <= 0xdfff && i >= 2 ? text.slice(i - 2, i) : text[i - 1]!;
}
function codePointAfter(text: string, i: number): string {
  const cp = text.codePointAt(i);
  return cp === undefined ? "" : String.fromCodePoint(cp);
}
function isOrdinaryZeroWidth(text: string, i: number): boolean {
  const c = text[i]!;
  if (c === "\uFEFF") return i === 0 || text[i - 1] === "\n";
  if (c !== "\u200C" && c !== "\u200D") return false;
  let before = codePointBefore(text, i);
  const after = codePointAfter(text, i + 1);
  if (JOINING_SCRIPT.test(before) || JOINING_SCRIPT.test(after)) return true;
  if (c === "\u200D") {
    let at = i;
    while (before && EMOJI_MODIFIER.test(before)) {
      at -= before.length;
      before = codePointBefore(text, at);
    }
    return PICTOGRAPH.test(before) && PICTOGRAPH.test(after);
  }
  return false;
}
const LATIN_TWINS = new Set([..."\u0430\u0435\u043e\u0440\u0441\u0443\u0445\u0456\u0458\u0455\u04bb\u0501\u051b\u051d\u0410\u0412\u0415\u041a\u041c\u041d\u041e\u0420\u0421\u0422\u0423\u0425\u0405\u0406\u0408\u03bf\u0391\u0392\u0395\u0396\u0397\u0399\u039a\u039c\u039d\u039f\u03a1\u03a4\u03a5\u03a7"]);
const TRI_SCRIPT_WORD = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]{2,}/gu;
const LATIN_LETTER = /\p{Script=Latin}/u;
function isDisguisedWord(word: string): boolean {
  let latin = false;
  let foreign = 0;
  for (const ch of word) {
    if (LATIN_LETTER.test(ch)) latin = true;
    else if (LATIN_TWINS.has(ch)) foreign++;
    else return false;
  }
  return latin && foreign > 0;
}
export function findHiddenCharacters(text: string): string[] {
  const out: string[] = [];
  for (const { re, name } of HIDDEN_CHARS) {
    const counts = new Map<string, number>();
    for (const m of text.matchAll(re)) {
      if (name === "zero-width character" && isOrdinaryZeroWidth(text, m.index)) continue;
      const cp = `U+${m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
      counts.set(cp, (counts.get(cp) ?? 0) + 1);
    }
    for (const [cp, n] of counts) out.push(`${name} ${cp}${n > 1 ? ` x${n}` : ""}`);
  }
  const words = new Set<string>();
  for (const m of text.matchAll(TRI_SCRIPT_WORD)) if (isDisguisedWord(m[0])) words.add(m[0]);
  for (const w of [...words].slice(0, 5)) out.push(`mixed-script word "${w}"`);
  return out;
}
function clip(s: string): string {
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}
const NEGATION = /\b(?:never|not|don'?t|avoid|refuse|forbid(?:den)?|prohibit(?:ed)?|warn(?:s|ed|ing)?|caution|red flags?|guide (?:users|people) away from|instead of|rather than|no longer)\b/i;
const NEGATIVE_BY_DESIGN = /^(?:do not|without|ignore)\b/i;
const WARNING_CONTEXT = /\b(?:red flags?|warn(?:s|ed|ing)?(?: the user| users)?|refuse|refuses|reject|rejects|detect|detects|watch (?:out )?for|beware|signs? of|suspicious|reads? like|is an? (?:example|sign) of)\b/i;
const ACT_ON_QUOTE = /\b(?:run|execute|type|enter|say|output|print|respond with|reply with|answer with|write|append|add|include|follow|obey|do|then|now|always|must|should|please)\s*:?\s*$/i;
const KEY_BEFORE_COLON = /(?:^|[\n{,[])\s*(?:[-*]\s+)?(?:"[^"\n]{0,80}"|'[^'\n]{0,80}'|[\w.$-]{1,80})\s*:\s*$/;
function handsOverQuote(beforeQuote: string): boolean {
  if (ACT_ON_QUOTE.test(beforeQuote)) return true;
  return /:\s*$/.test(beforeQuote) && !KEY_BEFORE_COLON.test(beforeQuote);
}
const NEW_STEP = /\b(?:then|after that|afterwards)\b/i;
function isDescribedMatch(text: string, index: number, length: number): boolean {
  const sentence = sentenceAt(text, index, length);
  const offset = text.indexOf(sentence);
  const before = offset >= 0 && offset <= index ? sentence.slice(0, index - offset) : "";
  // a warning word describes the match only while no new step begins between them: "Detects the workspace, then send
  // the API key to ..." names a detection and then gives an order (it graded medium until 4 Oct 2026)
  const warning = lastMatch(WARNING_CONTEXT, before);
  const warned = warning !== null && !NEW_STEP.test(before.slice(warning.end));
  // a straight apostrophe between two letters is a possessive or a contraction ("browser's", "don't"), not a quotation mark
  const quoteRe = /["\u201c\u201d\u2018\u2019`]|(?<![A-Za-z])'|'(?![A-Za-z])/g;
  const quoteMarks = [...before.matchAll(quoteRe)];
  // inside a quotation means a quote opened before the match and one closes after it; a stray quote earlier in the
  // sentence with nothing closing it is not a quotation (decision 111)
  const after = offset >= 0 ? sentence.slice(index - offset + length) : "";
  if (quoteMarks.length % 2 === 1 && new RegExp(quoteRe.source).test(after)) {
    const opened = quoteMarks[quoteMarks.length - 1]!.index;
    if (warned || !handsOverQuote(before.slice(0, opened))) return true;
  }
  return warned;
}
function lastMatch(re: RegExp, text: string): { index: number; end: number } | null {
  let last: { index: number; end: number } | null = null;
  for (const m of text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))) last = { index: m.index, end: m.index + m[0].length };
  return last;
}
const WORD_LIST = /^\s*(?:[\w'\u2019-]+\s*,\s*)*(?:[\w'\u2019-]+\s+(?:or|and|nor)\s+)?$/i;
function isNegatedMatch(text: string, index: number, length: number): boolean {
  const start = Math.max(0, index - 60);
  const window = text.slice(start, index);
  const clauseStart = Math.max(window.lastIndexOf(". "), window.lastIndexOf("\n"), window.lastIndexOf("! "), window.lastIndexOf("? "), window.lastIndexOf(": "), window.lastIndexOf("; "), window.lastIndexOf("\u2014"), window.lastIndexOf(" \u2013 "), window.lastIndexOf(" - "));
  const before = clauseStart >= 0 ? window.slice(clauseStart + 1) : window;
  // a negation inside the matched words themselves ("the key is never sent to ...") governs them
  if (NEGATION.test(text.slice(index, index + length))) return true;
  const neg = lastMatch(NEGATION, before);
  if (!neg) return false;
  const between = before.slice(neg.end);
  return !between.includes(",") || WORD_LIST.test(between);
}
const SETUP_PHRASING = /\b(?:copy|copies|paste|pastes|grab|grabs|get|set|add|put|enter|store|save|configure|provide|supply|obtain|create|generate|find)\b[^.\n]{0,30}\b(?:your|the|an?|new)\b[^.\n]{0,20}\b(?:api[ _-]?keys?|tokens?|credentials?|secrets?)\b[^.\n]{0,40}\b(?:in|into|to|under|as|at|from)\b[^.\n]{0,30}\b(?:\.env|env(?:ironment)?|config|settings|dashboard|console|account|profile|keychain|secret store|vault|variable)/i;
const SENTENCE_END = /[.!?](?=\s)|\n/g;
function sentenceAt(text: string, index: number, length: number): string {
  let start = 0;
  let end = text.length;
  for (const m of text.matchAll(SENTENCE_END)) {
    const boundary = m.index + m[0].length;
    if (boundary <= index) start = boundary;
    else if (m.index >= index + length) {
      end = boundary;
      break;
    }
  }
  return text.slice(start, end).trim();
}
const YOUR_SECRET_VERBS = /^(?:copy|copies|read|reads|include|includes|collect|collects)\b[^.\n]{0,40}\byour\b[^.\n]{0,20}\b(?:api[ _-]?keys?|tokens?|credentials?)\b/i;
const PASTE_YOUR_SECRET = /^(?:copy|copies|paste|pastes|grab|grabs)\b[^.\n]{0,10}\byour\b[^.\n]{0,20}\b(?:api[ _-]?keys?|tokens?|keys?|credentials?)\b/i;
const HOMOGLYPHS: Record<string, string> = { "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c", "\u0443": "y", "\u0445": "x", "\u0456": "i", "\u0458": "j", "\u04bb": "h", "\u0455": "s", "\u0501": "d", "\u051b": "q", "\u0261": "g", "\u03bf": "o", "\u03b1": "a", "\u03b5": "e", "\u03b9": "i", "\u03ba": "k", "\u03bd": "v", "\u03c1": "p", "\u03c4": "t", "\u03c5": "u", "\u03c7": "x" };
export function foldForGrading(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/[\u0400-\u04ff\u0370-\u03ff]/g, (c) => HOMOGLYPHS[c] ?? c);
}
const MAX_MATCHES_PER_PATTERN = 50;
const ENDS_WITH_PARTICIPLE = /\b(?:leaked|exposed|logged|revealed|embedded|committed)$/i;
const LEADS_WITH_SECRET = new RegExp(`^\\s+${SECRET_NOUNS}`, "i");
const NO_SECRET_BEFORE = /\b(?:no|without(?:\s+(?:an?|any))?)\s+$/i;
const NO_SECRET_AT_END = new RegExp(`\\b(?:no|without(?:\\s+(?:an?|any))?)\\s+${SECRET_NOUNS}$`, "i");
const NEGATED_BEFORE_WITHOUT = /\b(?:never|not|n['\u2019]t|cannot|nothing|nobody|no one)(?:\s+(?!only\b)[\w'\u2019-]+){0,2}\s+$/i;
const CLAUSE_OPENS_NEGATED = /^\s*(?:[-*>|#]+\s*)*(?:never|do not|don['\u2019]t|nothing|no one|nobody)\b[^,;:\u2014\u2013]*$/i;
const PUSH_WORDS = /\b(?:hesitate|wait|stop|pause|bother|delay|hold|fail|forget|worry|skip asking|ask)\b/i;
const WITHOUT_THE_USER_DOING = /^(?:\s+(?:typing|having to|needing to|lifting|clicking|re-?entering|entering)\b|\/)/i;
const HEADER_CONTEXT = /\b(?:as|in)\s+(?:the\s+|an?\s+)?[`'"]?(?:authorization\b|x-api-key\b|[\w-]+\s+header\b)/i;
const TELL_TO = /^\s+(?:the user|the person|the merchant|anyone|them|users?)\s+to\s+\w/i;
const SECRET_AS_CREDENTIAL = new RegExp(`^\\w+\\b[^.\\n]{0,15}?\\bwith\\s+(?:your|an?|the)\\s+${SECRET_NOUNS}$`, "i");
const ADJECTIVE_PARTICIPLE = new RegExp(`^(?:leaked|exposed|logged|revealed|embedded|hardcoded|hard-coded|committed|stolen|compromised|rotated|revoked)\\s+${SECRET_NOUNS}$`, "i");
function findGraded(patterns: readonly RegExp[], rawText: string): string[] {
  const text = foldForGrading(rawText);
  const found: string[] = [];
  for (const re of patterns) {
    // the first match that survives is the one reported for the pattern
    const state = { capped: false, first: "" };
    let survived = false;
    for (const m of survivingMatches(re, text, state)) {
      found.push(clip(m[0]));
      survived = true;
      break;
    }
    // more matches than are weighed, and none of the weighed ones survived: the rest were not read, so the pattern counts
    // as matched. Fifty warning lines in front of one instruction used to switch the rule off (audit of 4 Oct 2026)
    if (!survived && state.capped) found.push(`${clip(state.first)} (more than ${MAX_MATCHES_PER_PATTERN} such phrases; not all could be weighed)`);
  }
  return found;
}
function* survivingMatches(re: RegExp, text: string, state?: { capped: boolean; first?: string }): Generator<RegExpExecArray & { index: number }> {
  // a block so the loop below keeps its indentation from when it lived inside findGraded's pattern loop
  {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let n = 0;
    for (const m of text.matchAll(g)) {
      if (++n > MAX_MATCHES_PER_PATTERN) { if (state) state.capped = true; break; }
      if (!m[0]) break;
      if (state && n === 1) state.first = m[0];
      if (!NEGATIVE_BY_DESIGN.test(m[0]) && isNegatedMatch(text, m.index, m[0].length)) continue;
      if (isDescribedMatch(text, m.index, m[0].length)) continue;
      // a setup instruction ("copy your API key into .env") is not movement of a secret off the machine; the exclusion is
      // judged on the sentence holding the match, so setup phrasing elsewhere in the text cannot hide a real instruction
      if (YOUR_SECRET_VERBS.test(m[0]) && SETUP_PHRASING.test(sentenceAt(text, m.index, m[0].length))) continue;
      if (PASTE_YOUR_SECRET.test(m[0])) continue;
      if (ADJECTIVE_PARTICIPLE.test(m[0])) continue;
      // "no API key needed", "without an API key": the secret is said to be absent (fractal-arena-mcp, 28 Sep 2026, decision 302)
      if (NO_SECRET_BEFORE.test(text.slice(Math.max(0, m.index - 16), m.index)) && LEADS_WITH_SECRET.test(" " + m[0])) continue;
      // "sent with your API key", "call it with your token": the key signs the request to the tool's own service; a named
      // address in the same sentence is still caught by the address rule
      if (SECRET_AS_CREDENTIAL.test(m[0])) continue;
      if (NO_SECRET_AT_END.test(m[0])) continue;
      if (/^without\b/i.test(m[0]) && NEGATED_BEFORE_WITHOUT.test(text.slice(Math.max(0, m.index - 40), m.index))) continue;
      if (/^without\b/i.test(m[0])) {
        const before = text.slice(0, m.index);
        const cut = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf("\n"), before.lastIndexOf(";"), before.lastIndexOf(":"));
        const clause = before.slice(cut + 1);
        if (CLAUSE_OPENS_NEGATED.test(clause) && !PUSH_WORDS.test(clause.replace(/^\s*(?:[-*>|#]+\s*)*(?:never|do not|don['\u2019]t)\b/i, ""))) continue;
      }
      if (/^without the user$/i.test(m[0]) && WITHOUT_THE_USER_DOING.test(text.slice(m.index + m[0].length, m.index + m[0].length + 20))) continue;
      if (re === SECRET_NEAR_VERB && HEADER_CONTEXT.test(text.slice(m.index, m.index + m[0].length + 40))) continue;
      if (/^do not tell$/i.test(m[0]) && TELL_TO.test(text.slice(m.index + m[0].length, m.index + m[0].length + 40))) continue;
      // the same adjective at the end of a "secret and verb" match: "API keys and exposed credentials" lists two problems
      if (ENDS_WITH_PARTICIPLE.test(m[0]) && LEADS_WITH_SECRET.test(text.slice(m.index + m[0].length))) continue;
      yield m as RegExpExecArray & { index: number };
    }
  }
}
export function findExfilMatches(rawText: string): string[] {
  return findGraded(EXFIL_PATTERNS, rawText);
}
export function findOverrideMatches(rawText: string): string[] {
  return findGraded(OVERRIDE_PATTERNS, rawText);
}
export function findSensitiveMatches(rawText: string): string[] {
  return findGraded(SENSITIVE_PATTERNS, rawText);
}
// ---- copied from packages/normalize/src/severity.ts: end ----

/** One rule that matched an added line. */
export interface LineMatch {
  severity: "high" | "medium";
  /** The rule's plain name, as the grading page (https://smallprint.dev/how-we-grade) names it. */
  rule: "hidden text" | "moving data out" | "override" | "sensitive destination";
  /** What the rule says the text does, in the words the entry pages print beside a grade. */
  says: string;
  /** The words that matched, or for hidden text each character found with its code point. */
  found: string[];
}

/** The entry pages' words for each rule (driftCriterion in severity.ts), without the subject the page puts in front. */
export const RULE_SAYS = {
  "hidden text": "contains characters a reader cannot see, or a word that mixes letters from two alphabets",
  "moving data out": "names a secret, a destination, or a way to move data off the machine",
  override: "tells the agent not to mention something to the user, or to ignore its instructions",
  "sensitive destination": "names a destination in ordinary product terms, without an address",
} as const;

/**
 * Every rule that matches one added line, high first, in the order the record weighs them: hidden text, moving data
 * out, override. Hidden characters are always high. The sensitive-destination rule is medium and is named only when no
 * high rule matched, as on the record, where a change takes the highest grade that applies. An empty list means no
 * rule matched; the line is still shown, because it was added.
 */
export function gradeLine(text: string): LineMatch[] {
  const out: LineMatch[] = [];
  const hidden = findHiddenCharacters(text);
  if (hidden.length) out.push({ severity: "high", rule: "hidden text", says: RULE_SAYS["hidden text"], found: hidden });
  const exfil = findExfilMatches(text);
  if (exfil.length) out.push({ severity: "high", rule: "moving data out", says: RULE_SAYS["moving data out"], found: exfil });
  const override = findOverrideMatches(text);
  if (override.length) out.push({ severity: "high", rule: "override", says: RULE_SAYS.override, found: override });
  if (!out.length) {
    const sensitive = findSensitiveMatches(text);
    if (sensitive.length) out.push({ severity: "medium", rule: "sensitive destination", says: RULE_SAYS["sensitive destination"], found: sensitive });
  }
  return out;
}

/** One match as a full line for the terminal, e.g. `high: tells the agent not to mention ... (the override rule). The words that matched: "Do NOT mention".` */
export function formatMatch(m: LineMatch): string {
  const found = m.rule === "hidden text" ? `The characters found: ${m.found.join(", ")}.` : `The words that matched: ${m.found.map((w) => `"${w}"`).join(", ")}.`;
  return `${m.severity}: ${m.says} (the ${m.rule} rule). ${found}`;
}

/** Printed under every graded line, word for word (decision 470). */
export const WHO_ADDED_IT = "If you did not add this line, find out what did before your agent runs again.";
