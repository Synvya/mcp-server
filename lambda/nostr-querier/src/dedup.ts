/**
 * In-memory deduplication of Nostr events for storage.
 * Kind 0: one per pubkey (replaceable, keep latest by created_at).
 * Kind 30000-39999: one per [kind, pubkey, d-tag] (replaceable).
 * Others: one per event id.
 */

import type { Event as NostrEvent } from 'nostr-tools';

function getDTag(event: NostrEvent): string | null {
  const dTag = event.tags.find(tag => tag[0] === 'd');
  return dTag ? dTag[1] : null;
}

/**
 * Build a deduplicated event map from a list of events.
 * Used by the Lambda before writing to DynamoDB.
 */
export function buildEventMap(events: NostrEvent[]): Map<string, NostrEvent> {
  const eventMap = new Map<string, NostrEvent>();

  for (const event of events) {
    if (event.kind === 31556) {
      const typeTag = event.tags.find((t: string[]) => t[0] === 'type');
      if (!typeTag || !typeTag[1]) continue;
    }

    if (event.kind === 0) {
      const kind0Key = `0:${event.pubkey}`;
      const existing = eventMap.get(kind0Key);
      if (!existing || event.created_at > existing.created_at) {
        eventMap.set(kind0Key, event);
      }
    } else if (event.kind >= 30000 && event.kind < 40000) {
      const dTag = getDTag(event);
      if (dTag) {
        const replaceableKey = `${event.kind}:${event.pubkey}:${dTag}`;
        const existing = eventMap.get(replaceableKey);
        if (!existing || event.created_at > existing.created_at) {
          eventMap.set(replaceableKey, event);
        }
      }
    } else {
      const existing = eventMap.get(event.id);
      if (!existing || event.created_at > existing.created_at) {
        eventMap.set(event.id, event);
      }
    }
  }

  return eventMap;
}
