import { describe, it, expect } from 'vitest';
import {
  extractLinks,
  normalizeUrl,
  isSafeHttpUrl,
  hostLabel,
  trimTrailingPunctuation,
} from './cardLinks';

/**
 * The Links section of the Card Editor is only as trustworthy as this parsing.
 * Two groups of tests matter more than the rest:
 *
 *   - "rejects unsafe schemes", which is the guard against a `javascript:` URL
 *     in imported card text becoming a live anchor
 *   - "keeps the list in step with the card", which is what stops the list from
 *     ever showing a link the card does not contain
 */

describe('normalizeUrl', () => {
  it('accepts http and https', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
    expect(normalizeUrl('http://example.com/a/b')).toBe('http://example.com/a/b');
  });

  it('assumes https for a bare www host', () => {
    expect(normalizeUrl('www.example.com')).toBe('https://www.example.com/');
    expect(normalizeUrl('WWW.Example.com/path')).toBe('https://www.example.com/path');
  });

  it('preserves the query string and fragment', () => {
    expect(normalizeUrl('https://example.com/s?q=cats&page=2#top'))
      .toBe('https://example.com/s?q=cats&page=2#top');
  });

  it('rejects unsafe schemes', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('JavaScript:alert(1)')).toBeNull();
    expect(normalizeUrl('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
    expect(normalizeUrl('vbscript:msgbox(1)')).toBeNull();
    expect(normalizeUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeUrl('blob:https://example.com/uuid')).toBeNull();
  });

  it('rejects a scheme smuggled past a naive check with whitespace', () => {
    // The URL parser strips tabs and newlines, so this resolves to
    // javascript: and must still be refused.
    expect(normalizeUrl('java\nscript:alert(1)')).toBeNull();
    expect(normalizeUrl('  javascript:alert(1)  ')).toBeNull();
  });

  it('rejects relative paths, because a card has no base URL', () => {
    expect(normalizeUrl('/docs/setup')).toBeNull();
    expect(normalizeUrl('./notes.md')).toBeNull();
    expect(normalizeUrl('example.com')).toBeNull();
  });

  it('rejects a URL with no host at all', () => {
    expect(normalizeUrl('http://')).toBeNull();
    expect(normalizeUrl('https://')).toBeNull();
  });

  it('follows the URL spec on an extra slash, which names a host', () => {
    // Surprising but correct: for http/https the parser reads the first segment
    // after the slashes as the hostname, so this is an absolute link to the host
    // "path". Asserted rather than "fixed" — the browser would do the same thing
    // with this href, and the list should show what clicking will actually do.
    expect(normalizeUrl('https:///path')).toBe('https://path/');
  });

  it('rejects empty and non-string input', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
    expect(normalizeUrl(null)).toBeNull();
    expect(normalizeUrl(undefined)).toBeNull();
    expect(normalizeUrl(42)).toBeNull();
  });
});

describe('isSafeHttpUrl', () => {
  it('agrees with normalizeUrl', () => {
    expect(isSafeHttpUrl('https://example.com')).toBe(true);
    expect(isSafeHttpUrl('www.example.com')).toBe(true);
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('/relative')).toBe(false);
  });
});

describe('hostLabel', () => {
  it('uses the hostname without www', () => {
    expect(hostLabel('https://www.example.com/a/b')).toBe('example.com');
    expect(hostLabel('https://docs.example.co.uk/x')).toBe('docs.example.co.uk');
  });
});

describe('trimTrailingPunctuation', () => {
  it('removes sentence punctuation', () => {
    expect(trimTrailingPunctuation('https://example.com.')).toBe('https://example.com');
    expect(trimTrailingPunctuation('https://example.com,')).toBe('https://example.com');
    expect(trimTrailingPunctuation('https://example.com?!')).toBe('https://example.com');
    expect(trimTrailingPunctuation('https://example.com"')).toBe('https://example.com');
  });

  it('removes an unbalanced closing bracket', () => {
    expect(trimTrailingPunctuation('https://example.com/a)')).toBe('https://example.com/a');
    expect(trimTrailingPunctuation('https://example.com/a]')).toBe('https://example.com/a');
  });

  it('keeps a balanced closing bracket, which is part of the address', () => {
    expect(trimTrailingPunctuation('https://en.wikipedia.org/wiki/Cat_(animal)'))
      .toBe('https://en.wikipedia.org/wiki/Cat_(animal)');
  });

  it('leaves a clean URL untouched', () => {
    expect(trimTrailingPunctuation('https://example.com/a/b')).toBe('https://example.com/a/b');
  });
});

describe('extractLinks — what counts as a link', () => {
  it('finds a bare URL in prose', () => {
    expect(extractLinks('', 'Read https://example.com/guide before starting.'))
      .toEqual([{ url: 'https://example.com/guide', label: 'example.com' }]);
  });

  it('finds a markdown link and uses its label', () => {
    expect(extractLinks('', 'See [the guide](https://example.com/guide) first.'))
      .toEqual([{ url: 'https://example.com/guide', label: 'the guide' }]);
  });

  it('falls back to the hostname when a markdown label is empty', () => {
    expect(extractLinks('', '[](https://example.com/guide)'))
      .toEqual([{ url: 'https://example.com/guide', label: 'example.com' }]);
  });

  it('finds an angle-bracket autolink', () => {
    expect(extractLinks('', 'Ping <https://example.com/status> to check.'))
      .toEqual([{ url: 'https://example.com/status', label: 'example.com' }]);
  });

  it('finds a www host with no scheme', () => {
    expect(extractLinks('', 'try www.example.com today'))
      .toEqual([{ url: 'https://www.example.com/', label: 'example.com' }]);
  });

  it('ignores a markdown link title attribute', () => {
    expect(extractLinks('', '[Docs](https://example.com/d "The docs")'))
      .toEqual([{ url: 'https://example.com/d', label: 'Docs' }]);
  });

  it('scans the title as well as the content', () => {
    expect(extractLinks('https://example.com/parked', 'no links here'))
      .toEqual([{ url: 'https://example.com/parked', label: 'example.com' }]);
  });

  it('lists title links before content links', () => {
    const links = extractLinks('https://title.example.com', 'and https://content.example.com');
    expect(links.map((l) => l.url)).toEqual([
      'https://title.example.com/',
      'https://content.example.com/',
    ]);
  });
});

describe('extractLinks — order and duplicates', () => {
  it('returns links in the order they appear', () => {
    const content = 'First https://one.example.com then [two](https://two.example.com) then <https://three.example.com>';
    expect(extractLinks('', content).map((l) => l.url)).toEqual([
      'https://one.example.com/',
      'https://two.example.com/',
      'https://three.example.com/',
    ]);
  });

  it('counts a markdown link once, not once per pass', () => {
    // The URL sits inside the [label](...) span. If the bare-URL pass also saw
    // it, this card would show two identical rows.
    expect(extractLinks('', '[Docs](https://example.com/docs)')).toHaveLength(1);
  });

  it('collapses a repeated URL and keeps the first label', () => {
    const content = '[First name](https://example.com/x) and later [Second name](https://example.com/x)';
    expect(extractLinks('', content))
      .toEqual([{ url: 'https://example.com/x', label: 'First name' }]);
  });

  it('treats URLs differing only by path as separate links', () => {
    expect(extractLinks('', 'https://example.com/a https://example.com/b')).toHaveLength(2);
  });
});

describe('extractLinks — code', () => {
  it('ignores URLs inside a fenced code block', () => {
    const content = [
      'Real link: https://real.example.com',
      '',
      '```js',
      "fetch('https://sample.example.com/api')",
      '```',
    ].join('\n');

    expect(extractLinks('', content))
      .toEqual([{ url: 'https://real.example.com/', label: 'real.example.com' }]);
  });

  it('ignores an unterminated fence to the end of the card', () => {
    const content = 'Before https://real.example.com\n```\nhttps://sample.example.com';
    expect(extractLinks('', content))
      .toEqual([{ url: 'https://real.example.com/', label: 'real.example.com' }]);
  });

  it('still finds a URL in inline backticks', () => {
    expect(extractLinks('', 'Call `https://api.example.com/v1` for data.'))
      .toEqual([{ url: 'https://api.example.com/v1', label: 'api.example.com' }]);
  });
});

describe('extractLinks — safety', () => {
  it('never returns a javascript: URL, however it is written', () => {
    const content = [
      '[click me](javascript:alert(1))',
      '<javascript:alert(2)>',
      'javascript:alert(3)',
    ].join('\n');

    expect(extractLinks('', content)).toEqual([]);
  });

  it('never returns a data: URL', () => {
    expect(extractLinks('', '[x](data:text/html;base64,PHNjcmlwdD4=)')).toEqual([]);
  });

  it('keeps the safe links from a card that also contains unsafe ones', () => {
    const content = '[bad](javascript:alert(1)) and [good](https://example.com/ok)';
    expect(extractLinks('', content))
      .toEqual([{ url: 'https://example.com/ok', label: 'good' }]);
  });
});

describe('extractLinks — empty and odd input', () => {
  it('returns an empty array for a card with no links', () => {
    expect(extractLinks('Just a title', 'Some notes with no address in them.')).toEqual([]);
  });

  it('survives empty, missing and non-string fields', () => {
    expect(extractLinks('', '')).toEqual([]);
    expect(extractLinks(null, null)).toEqual([]);
    expect(extractLinks(undefined, undefined)).toEqual([]);
    expect(extractLinks(0, {})).toEqual([]);
  });

  it('does not treat plain text with brackets as a link', () => {
    expect(extractLinks('', '[a note](not a url) and [another](/relative)')).toEqual([]);
  });
});
