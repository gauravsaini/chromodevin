/**
 * Candidate span extraction & spoken text/URL normalizer.
 * Pure functional unit: explicit input/output contract, zero side effects.
 */

const TLDS = 'com|org|net|io|ai|dev|co|edu|gov|de|uk|us|app|xyz|info|me|tv|ch|at|fr|nl|es|it';
const FILLER_RE = /\b(please|thanks|thank you|now|okay|ok|um|uh|and then|can you)\b/gi;

// Verbs that introduce payload text (longer/more specific first)
const TEXT_VERBS = [
  /\b(?:search|look)\s+(?:for|up)\s+/i,
  /\bsearch\s+(?:on\s+)?(?:google|duckduckgo|wikipedia|youtube|github|amazon|reddit|twitter|x|hacker news|the web)\s+for\s+/i,
  /\bsearch\s+/i,
  /\bgoogle\s+/i,
  /\bfind\s+/i,
  /\btype\s+(?:in\s+)?/i,
  /\benter\s+/i,
  /\bwrite\s+/i,
  /\bput\s+/i,
  /\bfill\s+(?:in\s+)?/i,
  /\badd\s+(?:todo|task|item)\s+/i
];

// Trailing destination phrases to strip from payload: "... into the search box"
const TRAILING_DEST_RE =
  /\s+(?:in|into|on|inside|to)\s+(?:the\s+)?(?:[\w-]+\s+){0,4}?(?:box|field|input|bar|form|textarea|search|wikipedia|youtube|google|duckduckgo|github|amazon|reddit|twitter|x|web)\b.*$/i;

// Leading site phrases: "wikipedia for cats" -> "cats"
const LEADING_SITE_RE =
  /^(?:on\s+|in\s+)?(?:google|duckduckgo|wikipedia|youtube|github|amazon|reddit|twitter|x|hacker news|the web)\s+(?:for\s+)?/i;

const NUMBER_WORDS: Record<string, number> = {
  one: 1, first: 1, '1': 1, '1st': 1,
  two: 2, second: 2, '2': 2, '2nd': 2,
  three: 3, third: 3, '3': 3, '3rd': 3,
  four: 4, fourth: 4, '4': 4, '4th': 4,
  five: 5, fifth: 5, '5': 5, '5th': 5,
  six: 6, sixth: 6, '6': 6, '6th': 6,
  seven: 7, seventh: 7, '7': 7, '7th': 7,
  eight: 8, eighth: 8, '8': 8, '8th': 8,
  nine: 9, ninth: 9, '9': 9, '9th': 9
};

const NUMBER_HOMOPHONES: Record<string, number> = {
  won: 1,
  to: 2,
  too: 2,
  for: 4
};

const PICK_STOPWORDS = new Set([
  'the', 'number', 'option', 'pick', 'choose', 'select', 'click', 'take', 'that', 'please',
  'link', 'item', 'result', 'go', 'with', 'on', 'yes', 'this', 'um', 'uh'
]);

export function cleanTranscript(text: string): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripFiller(s: string): string {
  return s
    .replace(FILLER_RE, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[.,!?]+$/g, '')
    .trim();
}

function pushUnique(list: string[], value: string): void {
  const v = stripFiller(value);
  if (!v || v.length > 120) return;
  if (list.some((x) => x.toLowerCase() === v.toLowerCase())) return;
  list.push(v);
}

/**
 * Extracts verbatim candidate text payloads for search/type intents.
 * Pure function: deterministic mapping from transcript string to candidate array.
 */
export function extractTextCandidates(transcript: string): string[] {
  const t = cleanTranscript(transcript);
  if (!t) return [];
  const out: string[] = [];

  // 1. Quoted spans
  for (const m of t.matchAll(/["“”']([^"“”']{1,120})["“”']/g)) {
    pushUnique(out, m[1]);
  }

  // 2. Text after payload verbs
  const verbMatches = TEXT_VERBS.map((re) => re.exec(t))
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => a.index - b.index || b[0].length - a[0].length);

  for (const m of verbMatches) {
    let tail = t.slice(m.index + m[0].length);
    tail = tail.replace(LEADING_SITE_RE, '');
    const stripped = tail.replace(TRAILING_DEST_RE, '');
    pushUnique(out, stripped);
    if (stripped !== tail) pushUnique(out, tail);
  }

  // 3. Tail after "for"
  const forIdx = t.toLowerCase().indexOf(' for ');
  if (forIdx >= 0) {
    pushUnique(out, t.slice(forIdx + 5).replace(TRAILING_DEST_RE, ''));
  }

  // 4. Tail after first word (e.g. "type hello")
  const firstSpace = t.indexOf(' ');
  if (firstSpace > 0) {
    pushUnique(out, t.slice(firstSpace + 1).replace(TRAILING_DEST_RE, ''));
  }

  // 5. Full transcript fallback
  pushUnique(out, t);

  return out.slice(0, 8);
}

/**
 * Normalizes spoken URL representations (e.g. "example dot com" -> "example.com").
 * Pure function.
 */
export function normalizeSpokenUrl(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+dot\s+/g, '.')
    .replace(/\s*\.\s*/g, '.')
    .replace(/\s+slash\s+/g, '/')
    .replace(/\bwww\s+/g, 'www.')
    .replace(/\bh\s*t\s*t\s*p\s*s?\s*:\s*\/\s*\/\s*/g, (m) => (m.includes('s') ? 'https://' : 'http://'));
}

/**
 * Extracts domain-looking candidate spans from a spoken transcript.
 * Pure function.
 */
export function extractUrlCandidates(transcript: string): string[] {
  const t = normalizeSpokenUrl(cleanTranscript(transcript));
  if (!t) return [];
  const re = new RegExp(`(?:https?://)?(?:[a-z0-9-]+\\.)+(?:${TLDS})(?:/[^\\s]*)?`, 'gi');
  const out: string[] = [];
  for (const m of t.matchAll(re)) {
    const v = m[0].replace(/[.,!?]+$/, '');
    if (!out.includes(v)) out.push(v);
  }
  return out.slice(0, 6);
}

/**
 * Ensures a domain-like string has an https:// protocol.
 */
export function toHttpUrl(domainish: string): string {
  const v = String(domainish || '').trim();
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

/**
 * Parses spoken number or ordinal candidate picks (e.g. "two", "the second one", "option 3").
 * Enables zero-model candidate execution when disambiguation overlays are present.
 * Pure function.
 */
export function parseCandidatePick(transcript: string, max = 5): number | null {
  const t = cleanTranscript(transcript).toLowerCase().replace(/[.,!?]/g, '');
  if (!t) return null;
  const words = t.split(' ').filter((w) => !PICK_STOPWORDS.has(w));
  if (words.length === 0 || words.length > 2) return null;

  for (const w of words) {
    const n = NUMBER_WORDS[w];
    if (n && n <= max) return n;
  }

  if (words.length === 1) {
    const n = NUMBER_HOMOPHONES[words[0]];
    if (n && n <= max) return n;
  }

  return null;
}
