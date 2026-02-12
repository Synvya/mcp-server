import { HandleNpubMap } from './types.js';

const JSON_LD_REGEX = /<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi;

/**
 * Extract the Nostr npub from a schema.org JSON-LD block in HTML.
 * Returns the @id value if it starts with "nostr:npub1", or null.
 */
export function extractNpubFromHtml(html: string): string | null {
  let match: RegExpExecArray | null;
  JSON_LD_REGEX.lastIndex = 0;

  while ((match = JSON_LD_REGEX.exec(html)) !== null) {
    try {
      const jsonLd = JSON.parse(match[1]);
      const id = jsonLd['@id'];
      if (typeof id === 'string' && id.startsWith('nostr:npub1')) {
        return id;
      }
    } catch {
      // Malformed JSON-LD block — skip
    }
  }

  return null;
}

/**
 * Extract the restaurant handle from an S3 key.
 * e.g., "restaurant/india-belly/index.html" → "india-belly"
 *       "cafe/trail-youth-coffee/index.html" → "trail-youth-coffee"
 */
export function extractHandleFromKey(key: string): string | null {
  const segments = key.split('/');
  if (segments.length < 2 || !segments[1]) {
    return null;
  }
  return segments[1];
}

/**
 * Build a handle → npub lookup map from an array of HTML files.
 */
export function buildHandleNpubMap(
  htmlFiles: Array<{ key: string; html: string }>
): HandleNpubMap {
  const map: HandleNpubMap = {};

  for (const { key, html } of htmlFiles) {
    const handle = extractHandleFromKey(key);
    if (!handle) {
      console.warn(`Could not extract handle from key: ${key}`);
      continue;
    }

    const npub = extractNpubFromHtml(html);
    if (!npub) {
      console.warn(`No npub found in JSON-LD for: ${key}`);
      continue;
    }

    map[handle] = npub;
  }

  return map;
}
