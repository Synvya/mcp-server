import { describe, it, expect } from 'vitest';
import { extractNpubFromHtml, extractHandleFromKey, buildHandleNpubMap } from './html-parser.js';

describe('extractNpubFromHtml', () => {
  it('extracts npub from valid JSON-LD script block', () => {
    const html = `
      <html><head>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Restaurant",
        "@id": "nostr:npub1t85rs59w77chespqprsqkyqg878tgqqmj2rqktc7rdtw43jd75gs5fdqvj",
        "name": "India Belly"
      }
      </script>
      </head><body></body></html>
    `;
    expect(extractNpubFromHtml(html)).toBe(
      'nostr:npub1t85rs59w77chespqprsqkyqg878tgqqmj2rqktc7rdtw43jd75gs5fdqvj'
    );
  });

  it('returns null when no JSON-LD script block exists', () => {
    const html = '<html><head></head><body>Hello</body></html>';
    expect(extractNpubFromHtml(html)).toBeNull();
  });

  it('returns null when JSON-LD has no @id field', () => {
    const html = `
      <script type="application/ld+json">
      {"@context": "https://schema.org", "@type": "Restaurant", "name": "Test"}
      </script>
    `;
    expect(extractNpubFromHtml(html)).toBeNull();
  });

  it('returns null when @id does not start with nostr:npub1', () => {
    const html = `
      <script type="application/ld+json">
      {"@id": "https://example.com/restaurant/123"}
      </script>
    `;
    expect(extractNpubFromHtml(html)).toBeNull();
  });

  it('handles malformed JSON gracefully', () => {
    const html = `
      <script type="application/ld+json">
      { this is not valid json }
      </script>
    `;
    expect(extractNpubFromHtml(html)).toBeNull();
  });

  it('handles multiple JSON-LD blocks and returns first with valid npub', () => {
    const html = `
      <script type="application/ld+json">
      {"@type": "BreadcrumbList"}
      </script>
      <script type="application/ld+json">
      {"@id": "nostr:npub1abc123def456"}
      </script>
    `;
    expect(extractNpubFromHtml(html)).toBe('nostr:npub1abc123def456');
  });

  it('handles single-quoted type attribute', () => {
    const html = `
      <script type='application/ld+json'>
      {"@id": "nostr:npub1test"}
      </script>
    `;
    expect(extractNpubFromHtml(html)).toBe('nostr:npub1test');
  });
});

describe('extractHandleFromKey', () => {
  it('extracts handle from restaurant path', () => {
    expect(extractHandleFromKey('restaurant/india-belly/index.html')).toBe('india-belly');
  });

  it('extracts handle from cafe path', () => {
    expect(extractHandleFromKey('cafe/trail-youth-coffee/index.html')).toBe('trail-youth-coffee');
  });

  it('extracts handle from bakery path', () => {
    expect(extractHandleFromKey('bakery/sweet-treats/index.html')).toBe('sweet-treats');
  });

  it('returns null for root-level files', () => {
    expect(extractHandleFromKey('index.html')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractHandleFromKey('')).toBeNull();
  });
});

describe('buildHandleNpubMap', () => {
  const mkHtml = (npub: string) => `
    <script type="application/ld+json">{"@id": "${npub}"}</script>
  `;

  it('builds correct mapping from array of HTML files', () => {
    const files = [
      { key: 'restaurant/india-belly/index.html', html: mkHtml('nostr:npub1aaa') },
      { key: 'cafe/coffee-place/index.html', html: mkHtml('nostr:npub1bbb') },
    ];
    const map = buildHandleNpubMap(files);
    expect(map).toEqual({
      'india-belly': 'nostr:npub1aaa',
      'coffee-place': 'nostr:npub1bbb',
    });
  });

  it('skips files with no npub', () => {
    const files = [
      { key: 'restaurant/good/index.html', html: mkHtml('nostr:npub1aaa') },
      { key: 'restaurant/bad/index.html', html: '<html></html>' },
    ];
    const map = buildHandleNpubMap(files);
    expect(map).toEqual({ good: 'nostr:npub1aaa' });
  });

  it('skips files with unextractable handle', () => {
    const files = [
      { key: 'index.html', html: mkHtml('nostr:npub1aaa') },
    ];
    const map = buildHandleNpubMap(files);
    expect(map).toEqual({});
  });

  it('returns empty map for empty input', () => {
    expect(buildHandleNpubMap([])).toEqual({});
  });
});
